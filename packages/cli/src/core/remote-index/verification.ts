import { type INDEX_PUBLIC_KEYS, RegistryIndex, SignedIndex } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { VERSION } from "../../version";

type RemoteOutcome = "ok" | "timeout" | "network" | "not_found" | "invalid" | "unsupported";
export type RemoteFailure = Exclude<RemoteOutcome, "ok">;
const header = Schema.Struct({ formatVersion: Schema.Number, minCli: Schema.String });
const bytes = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

function supported(minCli: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(minCli)) return false;
  const minimum = minCli.split(".").map(Number);
  const current = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (current[i] ?? 0) - (minimum[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export const signatureValid = (envelope: SignedIndex, keys: typeof INDEX_PUBLIC_KEYS) =>
  Effect.tryPromise({
    try: async () => {
      const trusted = keys.find((key) => key.keyId === envelope.keyId);
      if (!trusted || !envelope.signature) return false;
      const key = await crypto.subtle.importKey(
        "spki",
        bytes(trusted.publicKey.replace(/-----[^-]+-----|\s/g, "")),
        "Ed25519",
        false,
        ["verify"],
      );
      return crypto.subtle.verify(
        "Ed25519",
        key,
        bytes(envelope.signature),
        new TextEncoder().encode(envelope.payload),
      );
    },
    catch: (): RemoteFailure => "invalid",
  });

export const verifyIndex = Effect.fn("remoteIndex.verify")(function* (
  text: string,
  options: { isDefaultUrl: boolean; keys: typeof INDEX_PUBLIC_KEYS },
) {
  const envelope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SignedIndex))(text).pipe(
    Effect.mapError((): RemoteFailure => "invalid"),
  );
  if (options.isDefaultUrl && !(yield* signatureValid(envelope, options.keys)))
    return yield* Effect.fail<RemoteFailure>("invalid");
  const version = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(header))(
    envelope.payload,
  ).pipe(Effect.mapError((): RemoteFailure => "invalid"));
  if (version.formatVersion > 1 || !supported(version.minCli))
    return yield* Effect.fail<RemoteFailure>("unsupported");
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RegistryIndex))(
    envelope.payload,
  ).pipe(Effect.mapError((): RemoteFailure => "invalid"));
});
