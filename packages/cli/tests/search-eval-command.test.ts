import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { loadRank, records, vocabulary } from "./helpers/search-command";
import { evaluate } from "./helpers/search-eval";
import { GoldenSet } from "./helpers/search-golden";
import { cliRoot, readJson } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

function expectMetrics(text: string, expected: ReturnType<typeof evaluate>["total"]) {
  const labels = [
    ["mrr", "MRR"],
    ["recallAt3", "recall(?:At|@|\\s+at\\s+)3"],
    ["fragmentRecallAt5", "fragment[ _-]*recall(?:At|@|\\s+at\\s+)5"],
  ] as const;
  for (const [metric, label] of labels) {
    const matches = [
      ...text.matchAll(new RegExp(`${label}[^\\d\\n]*([0-9]+(?:\\.[0-9]+)?)\\s*(%)?`, "gi")),
    ];
    const values = matches.map((match) => Number(match[1]) / (match[2] ? 100 : 1));
    expect(
      values.some((value) => Math.abs(value - expected[metric]) < 0.005),
      metric,
    ).toBe(true);
  }
}

function firstFusedStack(text: string, golden: GoldenSet, ids: ReadonlyArray<string>) {
  const query = golden.queries.find(({ id }) => id === "nomatch-firmware");
  if (query === undefined) throw new Error("Missing firmware judgment");
  const start = text.indexOf(query.id);
  expect(start).toBeGreaterThanOrEqual(0);
  const following = text.slice(start + query.id.length);
  const nextQuery = golden.queries
    .map(({ id }) => following.indexOf(id))
    .filter((index) => index >= 0);
  const block = following.slice(0, nextQuery.length ? Math.min(...nextQuery) : undefined);
  const fused = block.slice(block.toLowerCase().indexOf("fused"));
  return ids
    .map((id) => ({ id, position: fused.indexOf(id) }))
    .filter(({ position }) => position >= 0)
    .sort((a, b) => a.position - b.position)[0]?.id;
}

function evaluateCommand(home: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        "bun",
        ["--no-env-file", "--config=/dev/null", "run", "search:eval", ...args],
        {
          cwd: cliRoot,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            XDG_CONFIG_HOME: join(home, "config"),
            XDG_DATA_HOME: join(home, "data"),
            XDG_STATE_HOME: join(home, "state"),
            NO_COLOR: "1",
            ...env,
          },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60_000,
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (status) =>
        resolve({
          status,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }),
      );
    },
  );
}

// A real child plus embedding a complete registry takes about 25 s with the 41-stack registry and
// longer under a loaded gate.
test("eval compares lexical and fused metrics, calls embeddings only when requested [4.5c#13]", async () => {
  const golden = Schema.decodeUnknownSync(GoldenSet)(
    readJson(join(cliRoot, "tests/fixtures/search/golden.json")),
  );
  const queries = new Set(golden.queries.map(({ query }) => query));
  const target = Schema.decodeUnknownSync(
    (await import("@steamfield/stacks-format")).SearchMetadata,
  )(readJson(join(cliRoot, "registry/search/stacks/tauri-react.json")));
  const targetPhrases = [target.summary, ...target.requests];
  const inputs: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const decoded = Schema.decodeUnknownSync(
      Schema.Struct({
        input: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
      }),
    )(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const batch = typeof decoded.input === "string" ? [decoded.input] : decoded.input;
    inputs.push(...batch);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: batch.map((text, index) => ({
          object: "embedding",
          index,
          embedding:
            queries.has(text) || targetPhrases.some((phrase) => text.includes(phrase))
              ? [1, 0]
              : [0, 1],
        })),
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No embedding server port");
  const env = {
    OPENROUTER_API_KEY: "fake-local-key",
    OPENROUTER_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
  };
  try {
    const home = space.dir();
    const lexical = await evaluateCommand(home, ["--without-sidecars"], env);
    expect(lexical.status, lexical.stderr).toBe(0);
    expect(lexical.stderr).not.toMatch(/error|fake-local-key/i);
    for (const metric of [/MRR/i, /recall.?@?3/i, /fragment.*recall.?@?5/i])
      expect(lexical.stdout).toMatch(metric);
    expect(inputs).toEqual([]);
    const rank = await loadRank();
    const entries = await records();
    const aliases = vocabulary();
    const expected = evaluate((request) => {
      const result = rank({
        request,
        entries: entries.map(({ entry, evidence }) => ({
          entry,
          ...(evidence ? { evidence } : {}),
        })),
        vocabulary: aliases,
        limit: 20,
      });
      return [...result.stacks, ...result.fragments];
    }, golden);
    expectMetrics(lexical.stdout, expected.total);
    const fused = await evaluateCommand(home, ["--embeddings"], env);
    expect(fused.status, fused.stderr).toBe(0);
    expect(fused.stderr).not.toMatch(/error|fake-local-key/i);
    expect(fused.stdout).toMatch(/lexical/i);
    expect(fused.stdout).toMatch(/fused/i);
    expect(fused.stdout).toMatch(/holdout.*paraphrase|paraphrase.*holdout/i);
    for (const metric of [/MRR/i, /recall.?@?3/i, /fragment.*recall.?@?5/i])
      expect(fused.stdout).toMatch(metric);
    expect(
      firstFusedStack(
        fused.stdout,
        golden,
        entries.filter(({ entry }) => entry.kind === "stack").map(({ entry }) => entry.id),
      ),
    ).toBe("tauri-react");
    for (const query of golden.queries.filter(
      ({ split, pool }) => split === "holdout" && pool === "paraphrase",
    )) {
      expect(inputs).toContain(query.query);
      expect(fused.stdout).toContain(query.id);
    }
    expect(inputs.length).toBeGreaterThan(golden.queries.length);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 150_000);
