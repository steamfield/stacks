import { Schema } from "effect";
import { DetectedAgent } from "./agent.js";
import { GitHubLogin } from "./authors.js";
import { Kebab, Kind } from "./entry.js";

export const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));
export type Digest = typeof Digest.Type;

/** The successful ledger proof attached to an indexed stack. */
export const LastRun = Schema.Struct({
  date: Schema.String,
  result: Schema.Literal("pass"),
  agent: DetectedAgent,
  preset: Schema.String,
  minutesToGreen: Schema.NullOr(Schema.Number),
  fingerprint: Digest,
});
export type LastRun = typeof LastRun.Type;

export const IndexEntry = Schema.Struct({
  id: Kebab,
  kind: Kind,
  schemaVersion: Schema.Int,
  name: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  digest: Digest,
  composition: Schema.optionalKey(
    Schema.Record(Schema.String, Digest).check(
      Schema.makeFilter(
        (value) => Object.keys(value).every(Schema.is(Kebab)) || "invalid fragment id",
      ),
    ),
  ),
  lastRun: Schema.optionalKey(LastRun),
  /** The creator's GitHub login, from the registry's `authors.json`. */
  author: Schema.optionalKey(GitHubLogin),
}).check(
  Schema.makeFilter((entry) =>
    entry.kind === "stack"
      ? entry.composition !== undefined || "stacks require a composition"
      : (entry.composition === undefined && entry.lastRun === undefined) ||
        "fragments cannot carry stack proof fields",
  ),
);
export type IndexEntry = typeof IndexEntry.Type;

export const RegistryIndex = Schema.Struct({
  formatVersion: Schema.Literal(1),
  minCli: Schema.String,
  generatedAt: Schema.String,
  commit: Schema.String,
  entries: Schema.Array(IndexEntry),
});
export type RegistryIndex = typeof RegistryIndex.Type;

/** Ed25519 signs the exact UTF-8 payload bytes, including whitespace. */
export const SignedIndex = Schema.Struct({
  keyId: Schema.String,
  signature: Schema.String,
  payload: Schema.String,
});
export type SignedIndex = typeof SignedIndex.Type;
