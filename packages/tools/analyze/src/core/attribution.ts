import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AttributionKind = "manifest" | "label" | "none";

export type Attribution = {
  readonly kind: AttributionKind;
  readonly stack?: string;
  readonly with?: readonly string[];
  readonly preset?: string;
  readonly agent?: string;
  readonly fingerprint?: string;
  readonly label?: string;
};

export type AttributionRead = {
  readonly attribution: Attribution;
  readonly warning?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out;
}

export function readAttribution(targetAbs: string, label?: string): AttributionRead {
  const manifestPath = resolve(targetAbs, ".quickstacks", "manifest.json");
  if (!existsSync(manifestPath)) {
    if (label !== undefined) {
      return { attribution: { kind: "label", label } };
    }
    return { attribution: { kind: "none" } };
  }
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return {
      attribution: label !== undefined ? { kind: "label", label } : { kind: "none" },
      warning: `Could not read ${manifestPath}.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    return {
      attribution: label !== undefined ? { kind: "label", label } : { kind: "none" },
      warning: `Manifest at ${manifestPath} is malformed: ${reason}.`,
    };
  }
  if (!isObject(parsed)) {
    return {
      attribution: label !== undefined ? { kind: "label", label } : { kind: "none" },
      warning: `Manifest at ${manifestPath} is not a JSON object.`,
    };
  }
  const stack = asString(parsed.stack);
  const withArr = asStringArray(parsed.with);
  const preset = asString(parsed.preset);
  const agent = asString(parsed.agent);
  const fingerprint = asString(parsed.fingerprint);
  return {
    attribution: {
      kind: "manifest",
      stack,
      with: withArr,
      preset,
      agent,
      fingerprint,
      label,
    },
  };
}
