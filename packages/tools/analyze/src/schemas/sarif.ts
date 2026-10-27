// Deliberate subset of SARIF 2.1.0 — the authority is the OASIS JSON schema at
// https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json
// Extend this only when a reader actually needs a field, never speculatively.

export type SarifLogLevel = "note" | "warning" | "error" | undefined;

export type ArtifactLocation = {
  readonly uri?: string;
  readonly uriBaseId?: string;
};

export type PhysicalLocation = {
  readonly artifactLocation?: ArtifactLocation;
};

export type Location = {
  readonly physicalLocation?: PhysicalLocation;
};

export type Result = {
  readonly ruleId?: string;
  readonly level?: SarifLogLevel;
  readonly message?: { readonly text?: string };
  readonly locations?: ReadonlyArray<Location>;
  readonly partialFingerprints?: Readonly<Record<string, string>>;
};

export type ToolDriver = {
  readonly name?: string;
  readonly version?: string;
};

export type Tool = {
  readonly driver?: ToolDriver;
};

export type Invocation = {
  readonly executionSuccessful?: boolean;
  readonly exitCode?: number;
  readonly startTimeUtc?: string;
  readonly endTimeUtc?: string;
};

export type Artifact = {
  readonly location?: ArtifactLocation;
};

export type OriginalUriBaseId = { readonly uri?: string; readonly uriBaseId?: string };

export type Run = {
  readonly tool?: Tool;
  readonly invocations?: ReadonlyArray<Invocation>;
  readonly results?: ReadonlyArray<Result>;
  readonly artifacts?: ReadonlyArray<Artifact>;
  readonly originalUriBaseIds?: Readonly<Record<string, OriginalUriBaseId>>;
  readonly properties?: Readonly<Record<string, unknown>>;
};

export type SarifLog = {
  readonly version: string;
  readonly $schema?: string;
  readonly runs: ReadonlyArray<Run>;
  readonly properties?: Readonly<Record<string, unknown>>;
};

export type SarifRun = Run;

export type ValidationResult =
  | { readonly ok: true; readonly log: SarifLog }
  | { readonly ok: false; readonly reason: string; readonly version?: string };

const SCHEMA_URI =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json";

export function sarifSchemaUri(): string {
  return SCHEMA_URI;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSarif(value: unknown): ValidationResult {
  if (!isObject(value)) {
    return { ok: false, reason: "SARIF log must be a JSON object." };
  }
  const version = typeof value.version === "string" ? value.version : undefined;
  if (version !== "2.1.0") {
    return {
      ok: false,
      reason: `Unsupported SARIF version: expected "2.1.0", got ${JSON.stringify(version ?? null)}.`,
      version,
    };
  }
  const runs = value.runs;
  if (!Array.isArray(runs)) {
    return { ok: false, reason: "SARIF log is missing the runs array.", version };
  }
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (!isObject(run)) {
      return { ok: false, reason: `runs[${i}] is not an object.`, version };
    }
    const tool = run.tool;
    if (tool !== undefined && !isObject(tool)) {
      return { ok: false, reason: `runs[${i}].tool is not an object.`, version };
    }
    const results = run.results;
    if (results !== undefined && !Array.isArray(results)) {
      return { ok: false, reason: `runs[${i}].results is not an array.`, version };
    }
  }
  return { ok: true, log: value as SarifLog };
}

export function countResults(log: SarifLog): number {
  let total = 0;
  for (const run of log.runs) {
    if (Array.isArray(run.results)) {
      total += run.results.length;
    }
  }
  return total;
}
