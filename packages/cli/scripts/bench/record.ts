import { Effect, FileSystem, Path, Schema } from "effect";
import { appendRecord } from "../../src/core/ledger";
import { within } from "../../src/core/scaffold/write";
import { LedgerRecord } from "../../src/schemas/ledger";
import { Output } from "../../src/services/output";
import type { Prepared } from "./prepare";
import type { AgentRun } from "./run";
import { classify, type Verified } from "./verify";

export const record = (prepared: Prepared, agent: AgentRun, verified: Verified) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const date = prepared.date;
    const result = classify(agent, verified);
    const note = yield* nextNote(prepared);
    const row = yield* Schema.decodeUnknownEffect(LedgerRecord)({
      schemaVersion: 1,
      date,
      stack: prepared.options.stack,
      with: prepared.added,
      preset: prepared.options.preset,
      agent: prepared.adapter.id,
      agentVersion: prepared.agentVersion,
      mode: "headless",
      repoCommit: prepared.repoCommit,
      cli: prepared.cliVersion,
      fingerprint: prepared.fingerprint,
      briefWords: prepared.briefWords,
      result,
      agentEnded: agent.ended,
      run: verified.run,
      verifyRuns: verified.verifyRuns,
      minutesToGreen: verified.minutesToGreen,
      minutesToFirstTest: verified.minutesToFirstTest,
      agentMinutes: agent.minutes,
      interventions: verified.interventions,
      hooksFired: agent.hooks,
      ...(prepared.options.existing ? { continued: true } : {}),
      ...(note ? { note } : {}),
    });
    if (note) {
      yield* writeNote({ prepared, agent, verified, row, result, note });
      const appended = yield* Effect.result(appendRecord(prepared.registry, row));
      if (appended._tag === "Failure") {
        yield* output.note(
          `Could not append ledger; run note saved at ${note}. Recover this record:`,
        );
        yield* output.note(JSON.stringify(Schema.encodeSync(LedgerRecord)(row)));
        return 3;
      }
    }
    yield* output.result(
      row,
      `Bench ${row.stack}: ${result}, agent ended ${row.agentEnded}.\n${note ? `Note: ${note}\n` : ""}${prepared.options.keep ? `Kept: ${prepared.root}\n` : ""}Next: read the notes and verify record${note ? ", then commit the reviewed note and ledger" : ""}.`,
    );
    return 0;
  });

type NoteContext = {
  prepared: Prepared;
  agent: AgentRun;
  verified: Verified;
  row: LedgerRecord;
  result: ReturnType<typeof classify>;
};
const renderNote = ({ prepared, agent, verified, row, result }: NoteContext) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const date = prepared.date;
    // The ledger keeps exact minutes; the note rounds them for reading.
    const minutes = (value: number | null | undefined) =>
      value === null || value === undefined ? "never" : value.toFixed(1);
    const fragments = row.with.length
      ? `with ${row.with.map((id) => `\`${id}\``).join(", ")}`
      : "no added fragments";
    const outcome = noteOutcome(result);
    const markdown = `# Gate run: ${row.stack}, ${date}

| Field | Value |
|---|---|
| Stack and fragments | \`${row.stack}\`, ${fragments}, preset \`${row.preset}\` |
| Repo commit | \`${row.repoCommit}\` |
| CLI | Compiled dev binary stacks@${row.cli}, installed with the working registry |
| Agent | ${row.agent === "claude" ? "Claude Code" : row.agent} ${row.agentVersion}, headless; ${prepared.agentChoice} |
| Credentials | ${prepared.credentials.route} |
| Model | ${prepared.options.model ?? prepared.adapter.defaultModel ?? "agent default"} |
| Target agents | \`${row.agent}\` |
| Brief size | \`briefWords\` ${row.briefWords}, \`fixedWords\` ${prepared.fixedWords} |
| Times | first passing \`test\`-layer step ${minutes(row.minutesToFirstTest)} min; first green \`verify\` ${minutes(row.minutesToGreen)} min |
| Verify count | ${row.verifyRuns} agent runs; ${verified.wrapperCalls} wrapper calls${row.verifyRuns === verified.wrapperCalls ? "" : "; mismatch: agent may have called verify another way"} |
| Interventions | ${row.interventions ?? "unknown (NOTES.md missing)"} |
| Outcome | \`${outcome}\`, tamperCheck: "${row.run?.tamperCheck ?? "unknown"}"; ledger result ${result} |
| Agent ended | ${row.agentEnded}${agent.subtype ? ` (${agent.subtype})` : ""}; ${agent.turns ?? "unknown"} turns |
| Agent minutes | ${minutes(row.agentMinutes)} |
| Hooks fired | ${hooksText(row.hooksFired)} |
${verified.minutesToBase === null ? "" : `| Time to green base | ${minutes(verified.minutesToBase)} min |\n`}
This run has not been reviewed. Read the notes and relabel partial if a deliverable is missing.
${continuationText(prepared, path)}
## Agent notes

${verified.notes ?? "NOTES.md missing."}

## Run record

\`\`\`json
${JSON.stringify(row.run)}
\`\`\`
`;
    return markdown;
  });

function noteOutcome(result: ReturnType<typeof classify>): string {
  if (result === "pass") return "green";
  if (result === "infra") return "infra";
  return "failed";
}

const writeNote = ({
  prepared,
  agent,
  verified,
  row,
  result,
  note,
}: NoteContext & { note: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const previous = yield* previousNotePath(prepared);
    const markdown = yield* renderNote({ prepared, agent, verified, row, result });
    yield* fs.makeDirectory(path.join(prepared.repo, "plans/runs"), { recursive: true });
    yield* fs.writeFileString(path.join(prepared.repo, note), markdown, { flag: "wx" });
    if (previous)
      yield* fs.writeFileString(
        previous,
        `\nContinued in [${path.basename(note)}](${path.basename(note)}).\n`,
        { flag: "a" },
      );
    yield* fs.writeFileString(
      path.join(prepared.bench, "state.json"),
      JSON.stringify({
        with: prepared.added,
        ports: prepared.ports,
        fixedWords: prepared.fixedWords,
        note,
      }),
    );
  });

const previousNotePath = (prepared: Prepared) =>
  Effect.gen(function* () {
    if (!prepared.previousNote) return undefined;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const repo = yield* fs.realPath(prepared.repo);
    const runs = path.join(repo, "plans/runs");
    const previous = path.resolve(prepared.repo, prepared.previousNote);
    const actual = yield* fs.realPath(previous);
    if (!within(runs, actual, path.sep) || actual === runs)
      return yield* Effect.fail(new Error("Previous bench note must be under plans/runs"));
    return actual;
  });

function continuationText(prepared: Prepared, path: Path.Path): string {
  if (!prepared.options.existing) return "";
  const previous = prepared.previousNote
    ? `: [previous note](${path.basename(prepared.previousNote)})`
    : " (no recorded note)";
  return `\nContinued an earlier run${previous}. The continuation counts as one intervention.\n`;
}

const nextNote = (prepared: Prepared) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const date = prepared.date;
    let note: string | undefined;
    if (!prepared.options.noRecord) {
      const base = `plans/runs/${date}-${prepared.options.stack}`;
      note = `${base}.md`;
      for (let n = 2; yield* fs.exists(path.join(prepared.repo, note)); n++)
        note = `${base}-${n}.md`;
    }
    return note;
  });

function hooksText(hooks: LedgerRecord["hooksFired"]): string {
  if (hooks === null) return "unknown";
  return hooks?.join(", ") || "none";
}
