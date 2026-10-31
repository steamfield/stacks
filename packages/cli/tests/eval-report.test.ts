import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  type EvalReport,
  validateEvalReport,
} from "../registry/fragments/openrouter-ai/files/scripts/lib/eval-report";

const models = ["synthetic/model-a", "synthetic/model-b"];

function report(): EvalReport {
  return {
    schemaVersion: 1,
    mode: "stub",
    createdAt: "2026-10-28T00:00:00.000Z",
    cases: models.flatMap((requestedModel, model) =>
      ["currentTime", "concise-answer", "extract"].map((caseId, index) => ({
        caseId,
        requestedModel,
        verdict: "pass",
        finishReason: "stop",
        latencyMs: (index + 1) * 10 * (model + 1),
        inputTokens: (index + 1) * (model + 1),
        outputTokens: (index + 1) * 2 * (model + 1),
        cost: (index + 1) * 0.1 * (model + 1),
        servedModel: requestedModel,
        provider: "local",
      })),
    ),
    models: models.map((requestedModel, index) => ({
      requestedModel,
      total: 3,
      counts: { pass: 3, fail: 0, error: 0, truncated: 0 },
      inputTokens: 6 * (index + 1),
      outputTokens: 12 * (index + 1),
      cost: 0.6 * (index + 1),
      medianLatencyMs: 20 * (index + 1),
    })),
  };
}

function omit(value: object, field: string) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

test("validates separate models, order independence and an even median with an extra case", () => {
  const value = report();
  const first = value.cases[0];
  const summary = value.models[0];
  if (!first || !summary) throw new Error("fixture");
  value.cases.push({
    ...first,
    caseId: "additional",
    latencyMs: 40,
    inputTokens: 4,
    outputTokens: 8,
    cost: 0.4,
  });
  Object.assign(summary, {
    total: 4,
    counts: { pass: 4, fail: 0, error: 0, truncated: 0 },
    inputTokens: 10,
    outputTokens: 20,
    cost: 1,
    medianLatencyMs: 25,
  });
  value.cases.reverse();
  value.models.reverse();
  expect(validateEvalReport(value, models).issues).toEqual([]);
  expect(validateEvalReport({ ...value, mode: "live" }, models).issues).toEqual([]);
  expect(
    validateEvalReport({ ...value, createdAt: "2026-10-28T00:00:00Z" }, models).issues,
  ).toEqual([]);
});

test("unknown metadata propagates null independently for tokens and cost", () => {
  const value = report();
  const first = value.cases[0];
  const summary = value.models[0];
  if (!first || !summary) throw new Error("fixture");
  Object.assign(first, {
    inputTokens: null,
    outputTokens: null,
    cost: null,
    finishReason: null,
    servedModel: null,
    provider: null,
  });
  Object.assign(summary, { inputTokens: null, outputTokens: null, cost: null });
  expect(validateEvalReport(value, models).issues).toEqual([]);
  summary.inputTokens = 5;
  summary.outputTokens = 10;
  summary.cost = 0.5;
  expect(validateEvalReport(value, models).issues).toEqual([
    "models[0].inputTokens: aggregate mismatch",
    "models[0].outputTokens: aggregate mismatch",
    "models[0].cost: aggregate mismatch",
  ]);
});

test.each(["schemaVersion", "mode", "createdAt", "cases", "models"])(
  "rejects missing root %s",
  (field) => {
    expect(validateEvalReport(omit(report(), field), models).report).toBeNull();
  },
);

test.each([
  "caseId",
  "requestedModel",
  "verdict",
  "finishReason",
  "latencyMs",
  "inputTokens",
  "outputTokens",
  "cost",
  "servedModel",
  "provider",
])("rejects missing case %s rather than accepting aliases", (field) => {
  const value = report();
  const row = value.cases[0];
  if (!row) throw new Error("fixture");
  expect(
    validateEvalReport({ ...value, cases: [omit(row, field), ...value.cases.slice(1)] }, models)
      .issues,
  ).toEqual([`cases[0].${field}: invalid or missing field`]);
});

test.each([
  "requestedModel",
  "total",
  "counts",
  "inputTokens",
  "outputTokens",
  "cost",
  "medianLatencyMs",
])("rejects missing summary %s", (field) => {
  const value = report();
  const row = value.models[0];
  if (!row) throw new Error("fixture");
  expect(
    validateEvalReport({ ...value, models: [omit(row, field), ...value.models.slice(1)] }, models)
      .report,
  ).toBeNull();
});

test.each([
  ["inputTokens", -1],
  ["inputTokens", 0.5],
  ["outputTokens", Infinity],
  ["cost", NaN],
  ["cost", -1],
  ["latencyMs", Infinity],
  ["latencyMs", -1],
  ["requestedModel", " "],
  ["caseId", ""],
  ["provider", " "],
  ["servedModel", ""],
  ["finishReason", ""],
  ["finishReason", " "],
  ["verdict", "unknown"],
])("rejects invalid case %s value %s", (field, invalid) => {
  const value = report();
  expect(
    validateEvalReport(
      { ...value, cases: [{ ...value.cases[0], [field]: invalid }, ...value.cases.slice(1)] },
      models,
    ).report,
  ).toBeNull();
});

test.each(["total", "inputTokens", "outputTokens", "cost", "medianLatencyMs"])(
  "rejects wrong per-model %s",
  (field) => {
    const value = report();
    const result = validateEvalReport(
      { ...value, models: [{ ...value.models[0], [field]: 999 }, ...value.models.slice(1)] },
      models,
    );
    expect(result.issues).toContain(`models[0].${field}: aggregate mismatch`);
    expect(result.report).not.toBeNull();
  },
);

test.each(["pass", "fail", "error", "truncated"])("rejects wrong %s count", (verdict) => {
  const value = report();
  const first = value.models[0];
  if (!first) throw new Error("fixture");
  first.counts = { ...first.counts, [verdict]: 9 };
  expect(validateEvalReport(value, models).issues).toContain(
    `models[0].counts.${verdict}: aggregate mismatch`,
  );
});

test("rejects duplicates, missing required cases/summaries and unexpected models", () => {
  const value = report();
  const first = value.cases[0];
  const summary = value.models[0];
  if (!first || !summary) throw new Error("fixture");
  expect(validateEvalReport({ ...value, cases: [...value.cases, first] }, models).issues).toContain(
    "cases[6]: duplicate case/model",
  );
  expect(
    validateEvalReport({ ...value, models: [...value.models, summary] }, models).issues,
  ).toContain("models[2].requestedModel: duplicate summary");
  expect(validateEvalReport({ ...value, cases: value.cases.slice(1) }, models).issues).toContain(
    "models[0]: missing required case currentTime",
  );
  expect(validateEvalReport({ ...value, models: value.models.slice(1) }, models).issues).toContain(
    "models[0]: missing summary",
  );
  expect(validateEvalReport(value, ["other"]).issues).toContain(
    "cases[0].requestedModel: unexpected",
  );
  expect(validateEvalReport(value, ["other"]).issues).toContain(
    "models[0].requestedModel: unexpected",
  );
});

test.each(["fail", "error", "truncated"] as const)(
  "retains structurally valid %s reports and preserves truncated policy",
  (verdict) => {
    const value = report();
    value.cases = value.cases.map((row) => ({ ...row, verdict }));
    value.models = value.models.map((row) => ({
      ...row,
      counts: { pass: 0, fail: 0, error: 0, truncated: 0, [verdict]: 3 },
    }));
    const result = validateEvalReport(value, models);
    expect(result.report).not.toBeNull();
    expect(result.issues).toContain("cases: no passing cases");
    if (verdict !== "truncated")
      expect(result.issues).toContain("cases[0].verdict: failed outcome");
    if (verdict === "truncated") {
      const first = value.cases[0];
      const summary = value.models[0];
      if (!first || !summary) throw new Error("fixture");
      first.verdict = "pass";
      summary.counts.pass = 1;
      summary.counts.truncated = 2;
      expect(validateEvalReport(value, models).issues).toEqual([]);
    }
  },
);

test.each(["2026-02-30T00:00:00Z", "2026-10-28T00:00:00+00:00", "not a date"])(
  "rejects invalid UTC timestamp %s",
  (createdAt) => {
    expect(validateEvalReport({ ...report(), createdAt }).report).toBeNull();
  },
);

test("rejects empty collections and the retained incomplete Terra report unchanged", () => {
  expect(validateEvalReport({ ...report(), cases: [] }).report).toBeNull();
  expect(validateEvalReport({ ...report(), models: [] }).report).toBeNull();
  const evidence = readFileSync(
    join(import.meta.dirname, "fixtures/eval-dry-run-terra.txt"),
    "utf8",
  );
  const line = evidence.trim().split("\n").at(-1);
  if (!line) throw new Error("missing retained evidence");
  const value: unknown = JSON.parse(line);
  expect(validateEvalReport(value, models)).toEqual({
    report: null,
    issues: ["schemaVersion: invalid or missing field"],
  });
});
