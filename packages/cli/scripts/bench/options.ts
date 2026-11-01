import { parseArgs } from "node:util";
import { Effect } from "effect";

const usage = `Usage: bun scripts/bench.ts <stack> [options]

--with <a,b>          Add fragments
--preset <preset>     sandbox (default) or default
--agent <agent>       claude or codex (default: detected agent, else claude)
--model <id>          Agent model (default: haiku for claude, the agent's own for codex); letters, digits, ., -, _
--max-minutes <n>     Agent wall-clock limit, including fractional minutes (default: 60)
--cli <entry.mjs>     Install this Node entry and its sibling cli.mjs instead of building
--existing <dir>      Continue a kept bench root with matching composition
--keep                Keep the throwaway root
--no-record           Skip the run note and ledger write
--help                Show this help`;

export const help = `${usage}

Credentials: Claude requires CLAUDE_CODE_OAUTH_TOKEN from claude setup-token.
Codex uses CODEX_ACCESS_TOKEN from codex login --with-access-token, or codex login.
Only Codex auth.json is copied into the fresh HOME and removed when the agent exits.`;

export const options = (args: readonly string[]) =>
  Effect.try<Options | null, Error>({
    try: () => {
      const { values, positionals } = parseArgs({
        args: [...args],
        allowPositionals: true,
        options: {
          with: { type: "string" },
          preset: { type: "string", default: "sandbox" },
          agent: { type: "string" },
          model: { type: "string" },
          "max-minutes": { type: "string", default: "60" },
          cli: { type: "string" },
          existing: { type: "string" },
          keep: { type: "boolean", default: false },
          "no-record": { type: "boolean", default: false },
          help: { type: "boolean", default: false },
        },
      });
      if (values.help) return null;
      const stack = positionals[0];
      if (!stack || positionals.length !== 1) throw new Error(usage);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(stack)) throw new Error("Invalid stack id");
      const preset = values.preset;
      if (preset !== "sandbox" && preset !== "default")
        throw new Error("--preset must be sandbox or default");
      const model = modelId(values.model);
      const minutes = Number(values["max-minutes"]);
      if (!Number.isFinite(minutes) || minutes <= 0)
        throw new Error("--max-minutes must be a positive number");
      return {
        stack,
        with: [...new Set((values.with ?? "").split(",").filter(Boolean))].sort(),
        preset,
        agent: values.agent,
        model,
        minutes,
        cli: values.cli,
        existing: values.existing,
        keep: values.keep,
        noRecord: values["no-record"],
      };
    },
    catch: (error) => (error instanceof Error ? error : new Error("Invalid bench arguments")),
  });

function modelId(value: string | undefined): string | undefined {
  if (value !== undefined && !/^[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(value))
    throw new Error("Invalid model id: use letters, digits, ., -, _ with no leading -");
  return value;
}

export type Options = {
  stack: string;
  with: string[];
  preset: "sandbox" | "default";
  agent: string | undefined;
  model: string | undefined;
  minutes: number;
  cli: string | undefined;
  existing: string | undefined;
  keep: boolean;
  noRecord: boolean;
};
