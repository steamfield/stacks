/**
 * Decides whether a downloaded remote index can be believed and read by this CLI version.
 *
 * The remote index is an optional list of entries published at a URL; `core/remote-index.ts`
 * downloads it through `core/cached-fetch.ts` and hands the raw text to `verifyIndex`. The text is
 * a signed envelope: a `payload` (the index itself, as a JSON string) plus a `keyId` and an Ed25519
 * `signature` over that payload. For the official index URL the signature must verify against one
 * of the maintainers' public keys compiled into the CLI (`INDEX_PUBLIC_KEYS`); entries from it are
 * trusted (`.claude/rules/architecture.md`, "Trust model", point 2). A configured `STACKS_INDEX_URL`
 * skips the signature check because its entries are untrusted anyway.
 *
 * Each check fails with a short outcome word rather than an error: `invalid` for anything that
 * doesn't decode or verify, `unsupported` for an index written for a newer format or CLI. The
 * cached fetch records that word as the request's outcome and falls back to older data.
 * `core/allowlist.ts` reuses `signatureValid` for the signed dependency allowlist.
 */
import { type INDEX_PUBLIC_KEYS, RegistryIndex, SignedIndex } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { VERSION } from "../../version";

type RemoteOutcome = "ok" | "timeout" | "network" | "not_found" | "invalid" | "unsupported";
/** Why a remote request produced nothing usable; recorded as the cache's `lastOutcome`. */
export type RemoteFailure = Exclude<RemoteOutcome, "ok">;

/** The two payload fields read before the whole index, so a newer index fails as `unsupported`. */
const IndexHeader = Schema.Struct({ formatVersion: Schema.Number, minCli: Schema.String });

const base64Bytes = (text: string) =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** True when this CLI's version is at least `minCli`; a malformed `minCli` is never met. */
function cliMeetsMinimum(minCli: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(minCli)) return false;
  const minimum = minCli.split(".").map(Number);
  const current = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (current[i] ?? 0) - (minimum[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/**
 * True when the envelope's signature verifies under the trusted key its `keyId` names. An unknown
 * key or an empty signature is false; a key or signature that can't be imported fails as `invalid`.
 */
export const signatureValid = (envelope: SignedIndex, keys: typeof INDEX_PUBLIC_KEYS) =>
  Effect.tryPromise({
    try: async () => {
      const trusted = keys.find((key) => key.keyId === envelope.keyId);
      if (!trusted || !envelope.signature) return false;
      // The key is published as PEM; strip its armor lines and whitespace to get the DER bytes.
      const der = base64Bytes(trusted.publicKey.replace(/-----[^-]+-----|\s/g, ""));
      const key = await crypto.subtle.importKey("spki", der, "Ed25519", false, ["verify"]);
      return crypto.subtle.verify(
        "Ed25519",
        key,
        base64Bytes(envelope.signature),
        new TextEncoder().encode(envelope.payload),
      );
    },
    catch: (): RemoteFailure => "invalid",
  });

/**
 * Turns downloaded index text into a `RegistryIndex`, checking in this order: the envelope
 * decodes, the signature verifies (official URL only), the header decodes, the format and minimum
 * CLI version are supported, and the whole payload decodes.
 */
export const verifyIndex = Effect.fn("remoteIndex.verify")(function* (
  text: string,
  options: { isDefaultUrl: boolean; keys: typeof INDEX_PUBLIC_KEYS },
) {
  const envelope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SignedIndex))(text).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
  if (options.isDefaultUrl && !(yield* signatureValid(envelope, options.keys)))
    return yield* Effect.fail<RemoteFailure>("invalid");
  const header = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(IndexHeader))(
    envelope.payload,
  ).pipe(Effect.mapError((): RemoteFailure => "invalid"));
  if (header.formatVersion > 1 || !cliMeetsMinimum(header.minCli))
    return yield* Effect.fail<RemoteFailure>("unsupported");
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RegistryIndex))(
    envelope.payload,
  ).pipe(Effect.mapError((): RemoteFailure => "invalid"));
});
