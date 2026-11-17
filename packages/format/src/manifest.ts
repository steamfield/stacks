import { Schema } from "effect";
import { AgentId } from "./agent.js";
import { VerifyStep } from "./entry.js";

/**
 * An entry the project was composed from. `origin` is any non-empty string, not the `Origin`
 * literals, so an older `verify` reads a manifest that names an origin added later; code that
 * needs the literal narrows it and treats an unknown value as untrusted.
 */
export const EntryRef = Schema.Struct({
  id: Schema.String,
  origin: Schema.NonEmptyString,
  trusted: Schema.Boolean,
});
export type EntryRef = typeof EntryRef.Type;

/**
 * A verify step as `new` recorded it: the entry's step with defaults applied (an app's steps carry
 * the CLI's `app` tag, which `VerifyStep` refuses from an entry), its owner's id, and whether
 * verify skips it unless asked (`prod` steps under `--sandbox`).
 */
export const ManifestStep = Schema.Struct({
  ...VerifyStep.fields,
  owner: Schema.String,
  skipByDefault: Schema.Boolean,
}).check(
  Schema.makeFilter((step) =>
    step.phase === "serve" && !step.expect
      ? { path: ["expect"], issue: "a serve step needs expect" }
      : undefined,
  ),
);
export type ManifestStep = typeof ManifestStep.Type;

/**
 * A project id names the state record file, so it is limited to letters, digits and `-`: an
 * edited manifest can't point the state lookup outside its directory.
 */
export const ProjectId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/, { expected: "a project id such as a UUID" }),
);

/**
 * `.stacks/manifest.json`, schema version 1. `handoff` (1.4), `fingerprint` (2.0a),
 * `mode: "add"` and `stack: null` (3.0) are declared now so filling them needs no version bump.
 * Any other key is excess and fails decode.
 */
export const Manifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  projectId: ProjectId,
  /** ISO time, from Clock. */
  createdAt: Schema.String,
  /** The stacks version that wrote it. */
  cli: Schema.String,
  mode: Schema.Literals(["new", "add"]),
  /** Project template name; older manifests fall back to inference. */
  name: Schema.optionalKey(Schema.String),
  preset: Schema.Literals(["default", "sandbox"]),
  agents: Schema.Array(AgentId),
  stack: Schema.NullOr(EntryRef),
  fragments: Schema.Array(EntryRef),
  env: Schema.Record(Schema.String, Schema.String),
  commands: Schema.Record(Schema.String, Schema.String),
  /** Names are unique, as `compose` makes them: verify keys results and digests by step name. */
  verify: Schema.Array(ManifestStep).check(
    Schema.makeFilter((steps) => {
      const seen = new Set<string>();
      for (const [index, step] of steps.entries()) {
        if (seen.has(step.name))
          return { path: [index, "name"], issue: "step names must be unique" };
        seen.add(step.name);
      }
      return undefined;
    }),
  ),
  /** `"sha256:<hex>"` from the CLI's `digestSteps`. */
  verifyDigest: Schema.String,
  briefWords: Schema.Number,
  handoff: Schema.optionalKey(
    Schema.Struct({
      kind: Schema.Literals(["inside-agent", "launch", "print"]),
      agent: Schema.optionalKey(Schema.Union([AgentId, Schema.Literal("other")])),
      at: Schema.String,
    }),
  ),
  fingerprint: Schema.optionalKey(Schema.String),
});
export type Manifest = typeof Manifest.Type;
