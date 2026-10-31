export type Verdict = "pass" | "fail" | "error" | "truncated";
export type EvalCase = {
  caseId: string;
  requestedModel: string;
  verdict: Verdict;
  finishReason: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  servedModel: string | null;
  provider: string | null;
};
export type EvalModel = {
  requestedModel: string;
  total: number;
  counts: Record<Verdict, number>;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  medianLatencyMs: number;
};
export type EvalReport = {
  schemaVersion: 1;
  mode: "stub" | "live";
  createdAt: string;
  cases: EvalCase[];
  models: EvalModel[];
};

const verdicts: readonly Verdict[] = ["pass", "fail", "error", "truncated"];
const requiredCases = ["currentTime", "concise-answer", "extract"];

class InvalidField extends Error {}

function invalid(path: string): never {
  throw new InvalidField(`${path}: invalid or missing field`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) return invalid(path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return invalid(path);
  return value;
}

function numeric(value: unknown, path: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return invalid(path);
  if (integer && !Number.isSafeInteger(value)) return invalid(path);
  return value;
}

function nullableNumber(value: unknown, path: string, integer = false): number | null {
  return value === null ? null : numeric(value, path, integer);
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function timestamp(value: unknown): string {
  const result = text(value, "createdAt");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(result)) {
    return invalid("createdAt");
  }
  const parsed = new Date(result);
  const normalized = result.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`,
  );
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    return invalid("createdAt");
  }
  return result;
}

function evalCase(value: unknown, index: number): EvalCase {
  const path = `cases[${index}]`;
  const row = record(value, path);
  const verdict = row.verdict;
  if (verdict !== "pass" && verdict !== "fail" && verdict !== "error" && verdict !== "truncated") {
    return invalid(`${path}.verdict`);
  }
  return {
    caseId: text(row.caseId, `${path}.caseId`),
    requestedModel: text(row.requestedModel, `${path}.requestedModel`),
    verdict,
    finishReason: nullableText(row.finishReason, `${path}.finishReason`),
    latencyMs: numeric(row.latencyMs, `${path}.latencyMs`),
    inputTokens: nullableNumber(row.inputTokens, `${path}.inputTokens`, true),
    outputTokens: nullableNumber(row.outputTokens, `${path}.outputTokens`, true),
    cost: nullableNumber(row.cost, `${path}.cost`),
    servedModel: nullableText(row.servedModel, `${path}.servedModel`),
    provider: nullableText(row.provider, `${path}.provider`),
  };
}

function evalModel(value: unknown, index: number): EvalModel {
  const path = `models[${index}]`;
  const row = record(value, path);
  const counts = record(row.counts, `${path}.counts`);
  return {
    requestedModel: text(row.requestedModel, `${path}.requestedModel`),
    total: numeric(row.total, `${path}.total`, true),
    counts: {
      pass: numeric(counts.pass, `${path}.counts.pass`, true),
      fail: numeric(counts.fail, `${path}.counts.fail`, true),
      error: numeric(counts.error, `${path}.counts.error`, true),
      truncated: numeric(counts.truncated, `${path}.counts.truncated`, true),
    },
    inputTokens: nullableNumber(row.inputTokens, `${path}.inputTokens`, true),
    outputTokens: nullableNumber(row.outputTokens, `${path}.outputTokens`, true),
    cost: nullableNumber(row.cost, `${path}.cost`),
    medianLatencyMs: numeric(row.medianLatencyMs, `${path}.medianLatencyMs`),
  };
}

function decode(value: unknown): EvalReport {
  const root = record(value, "report");
  if (root.schemaVersion !== 1) return invalid("schemaVersion");
  if (root.mode !== "stub" && root.mode !== "live") return invalid("mode");
  if (!Array.isArray(root.cases) || root.cases.length === 0) return invalid("cases");
  if (!Array.isArray(root.models) || root.models.length === 0) return invalid("models");
  return {
    schemaVersion: 1,
    mode: root.mode,
    createdAt: timestamp(root.createdAt),
    cases: root.cases.map(evalCase),
    models: root.models.map(evalModel),
  };
}

function total(rows: readonly EvalCase[], key: "inputTokens" | "outputTokens" | "cost") {
  let sum = 0;
  for (const row of rows) {
    const value = row[key];
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

function median(rows: readonly EvalCase[]) {
  const values = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const upper = values[middle] ?? 0;
  return values.length % 2 === 0 ? (values[middle - 1] ?? 0) / 2 + upper / 2 : upper;
}

// Cost and latency allow 1e-9 absolute plus 1e-9 relative rounding error.
function close(actual: number | null, expected: number | null) {
  if (actual === null || expected === null) return actual === expected;
  return (
    Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-9 * (1 + Math.abs(expected))
  );
}

function checkSummary(summary: EvalModel, rows: readonly EvalCase[], path: string): string[] {
  const issues: string[] = [];
  if (summary.total !== rows.length) issues.push(`${path}.total: aggregate mismatch`);
  for (const verdict of verdicts) {
    if (summary.counts[verdict] !== rows.filter((row) => row.verdict === verdict).length) {
      issues.push(`${path}.counts.${verdict}: aggregate mismatch`);
    }
  }
  for (const key of ["inputTokens", "outputTokens"] as const) {
    if (summary[key] !== total(rows, key)) issues.push(`${path}.${key}: aggregate mismatch`);
  }
  if (!close(summary.cost, total(rows, "cost"))) issues.push(`${path}.cost: aggregate mismatch`);
  if (!close(summary.medianLatencyMs, median(rows))) {
    issues.push(`${path}.medianLatencyMs: aggregate mismatch`);
  }
  return issues;
}

function checkCases(report: EvalReport, models: readonly string[]): string[] {
  const seen = new Set<string>();
  const issues: string[] = [];
  report.cases.forEach((row, index) => {
    const key = JSON.stringify([row.caseId, row.requestedModel]);
    if (seen.has(key)) issues.push(`cases[${index}]: duplicate case/model`);
    seen.add(key);
    if (!models.includes(row.requestedModel))
      issues.push(`cases[${index}].requestedModel: unexpected`);
    if (row.verdict === "fail" || row.verdict === "error") {
      issues.push(`cases[${index}].verdict: failed outcome`);
    }
  });
  models.forEach((model, index) => {
    for (const caseId of requiredCases) {
      if (!seen.has(JSON.stringify([caseId, model]))) {
        issues.push(`models[${index}]: missing required case ${caseId}`);
      }
    }
  });
  if (!report.cases.some((row) => row.verdict === "pass")) issues.push("cases: no passing cases");
  return issues;
}

export function validateEvalReport(
  value: unknown,
  expectedModels?: readonly string[],
): { report: EvalReport | null; issues: string[] } {
  let report: EvalReport;
  try {
    report = decode(value);
  } catch (error) {
    if (error instanceof InvalidField) return { report: null, issues: [error.message] };
    throw error;
  }
  const models = expectedModels ?? report.models.map((row) => row.requestedModel);
  const issues = checkCases(report, models);
  const seen = new Set<string>();
  report.models.forEach((summary, index) => {
    const path = `models[${index}]`;
    if (seen.has(summary.requestedModel)) issues.push(`${path}.requestedModel: duplicate summary`);
    seen.add(summary.requestedModel);
    if (!models.includes(summary.requestedModel)) issues.push(`${path}.requestedModel: unexpected`);
    const rows = report.cases.filter((row) => row.requestedModel === summary.requestedModel);
    issues.push(...checkSummary(summary, rows, path));
  });
  models.forEach((model, index) => {
    if (!seen.has(model)) issues.push(`models[${index}]: missing summary`);
  });
  return { report, issues };
}
