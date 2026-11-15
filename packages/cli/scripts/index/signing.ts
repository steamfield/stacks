import { INDEX_PUBLIC_KEYS, type SignedIndex } from "@steamfield/stacks-format";
import { Effect, FileSystem, Schema } from "effect";

const bytes = (pem: string) =>
  Uint8Array.from(Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64"));
const payloadBytes = (payload: string) => new TextEncoder().encode(payload);

/**
 * INDEX_PUBLIC_KEYS plus `STACKS_INDEX_PUBLIC_KEYS` (a JSON array of `{ keyId, publicKey }`, the
 * variable stacks-api's deploy already sets), so a deploy key outside the package can verify the
 * previous index it carries entries forward from. A value that isn't such an array stops the build.
 */
export function trustedKeys(): typeof INDEX_PUBLIC_KEYS {
  const raw = process.env.STACKS_INDEX_PUBLIC_KEYS;
  if (raw === undefined || raw.trim() === "") return INDEX_PUBLIC_KEYS;
  const extra = Schema.decodeUnknownResult(Schema.fromJsonString(PublicKeys))(raw);
  if (extra._tag === "Failure")
    throw new Error("STACKS_INDEX_PUBLIC_KEYS must be a JSON array of { keyId, publicKey }.");
  return [...INDEX_PUBLIC_KEYS, ...extra.success];
}
const PublicKeys = Schema.Array(Schema.Struct({ keyId: Schema.String, publicKey: Schema.String }));

export const verifySignature = (envelope: SignedIndex, file: string) =>
  Effect.tryPromise({
    try: async () => {
      const trusted = trustedKeys().find((key) => key.keyId === envelope.keyId);
      if (trusted === undefined || envelope.signature === "")
        throw new Error("unknown key or unsigned file");
      const key = await crypto.subtle.importKey(
        "spki",
        bytes(trusted.publicKey),
        "Ed25519",
        false,
        ["verify"],
      );
      const valid = await crypto.subtle.verify(
        "Ed25519",
        key,
        Buffer.from(envelope.signature, "base64"),
        payloadBytes(envelope.payload),
      );
      if (!valid) throw new Error("invalid signature");
    },
    catch: (error) =>
      error instanceof Error && error.message.startsWith("STACKS_INDEX_PUBLIC_KEYS")
        ? error
        : new Error(
            `${file}: signature verification failed (unsigned, invalid, or untrusted key).`,
          ),
  });

export const signIndex = Effect.fn("index.sign")(function* (payload: string, keyPath?: string) {
  if (keyPath === undefined) return { keyId: "unsigned", signature: "", payload };
  const fs = yield* FileSystem.FileSystem;
  const pem = yield* fs
    .readFileString(keyPath)
    .pipe(Effect.mapError(() => new Error(`Signing key could not be read: ${keyPath}`)));
  const signature = yield* Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey("pkcs8", bytes(pem), "Ed25519", false, ["sign"]);
      return Buffer.from(await crypto.subtle.sign("Ed25519", key, payloadBytes(payload))).toString(
        "base64",
      );
    },
    catch: () => new Error(`Signing key is not a PKCS8 Ed25519 private key: ${keyPath}`),
  });
  for (const key of yield* Effect.try({ try: trustedKeys, catch: (error) => error as Error })) {
    const envelope = { keyId: key.keyId, signature, payload };
    const verified = yield* Effect.result(verifySignature(envelope, "v1/index.json"));
    if (verified._tag === "Success") return envelope;
  }
  return yield* Effect.fail(
    new Error(
      "Signing key has no matching public key in INDEX_PUBLIC_KEYS or STACKS_INDEX_PUBLIC_KEYS. Add its public key before publishing.",
    ),
  );
});
