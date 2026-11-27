/**
 * Verifies downloaded index envelopes and checks CLI compatibility. The cache uses failure outcomes
 * to record the reason and fall back to older data.
 */
import { type INDEX_PUBLIC_KEYS, RegistryIndex, SignedIndex } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { MIN_CLI_PATTERN } from "../../../schemas/registry-meta";
import type { IndexOutcome } from "../../../schemas/remote-index";
import { VERSION } from "../../../version";

type RemoteOutcome = typeof IndexOutcome.Type;
/**
 * The cache records decode failures as `invalid`, a failed signature check (unknown key or bad
 * signature) as `signature` and incompatibility as `unsupported`, so fallback retains the reason.
 */
export type RemoteFailure = Exclude<RemoteOutcome, "ok">;

/** The two payload fields read before the whole index, so a newer index fails as `unsupported`. */
const IndexHeader = Schema.Struct({ formatVersion: Schema.Number, minCli: Schema.String });

const base64Bytes = (text: string) =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** True when this CLI's version is at least `minCli`; a malformed `minCli` is never met. */
export function cliMeetsMinimum(minCli: string): boolean {
  if (!MIN_CLI_PATTERN.test(minCli)) return false;
  const minimum = minCli.split(".").map(Number);
  const current = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (current[i] ?? 0) - (minimum[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/**
 * Unknown keys and empty signatures return false. A key or signature that cannot be decoded
 * fails as `invalid`.
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
 * Require an Ed25519 signature over the raw payload under a compiled key for the official URL
 * (trust point 2). Configured origins get format and compatibility checks because `mergeIndex`
 * treats their downloads as untrusted.
 */
export const verifyIndex = Effect.fn("remoteIndex.verify")(function* (
  text: string,
  options: { isDefaultUrl: boolean; keys: typeof INDEX_PUBLIC_KEYS },
) {
  const envelope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SignedIndex))(text).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
  if (options.isDefaultUrl && !(yield* signatureValid(envelope, options.keys)))
    return yield* Effect.fail<RemoteFailure>("signature");
  const header = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(IndexHeader))(
    envelope.payload,
  ).pipe(Effect.mapError((): RemoteFailure => "invalid"));
  if (header.formatVersion > 1 || !cliMeetsMinimum(header.minCli))
    return yield* Effect.fail<RemoteFailure>("unsupported");
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RegistryIndex))(
    envelope.payload,
  ).pipe(Effect.mapError((): RemoteFailure => "invalid"));
});
