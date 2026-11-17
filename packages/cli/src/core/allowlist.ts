/**
 * Provides the signed dependency allowlist through `signatureValid` and `makeCachedFetch`.
 */
import {
  DependencyAllowlist,
  type INDEX_PUBLIC_KEYS,
  SignedIndex,
} from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../config";
import { type CacheFailure, makeCachedFetch } from "./cached-fetch";
import { signatureValid } from "./registry/remote/verification";

const verifyAllowlist = Effect.fn("allowlist.verify")(function* (
  text: string,
  keys: typeof INDEX_PUBLIC_KEYS,
) {
  const envelope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SignedIndex))(text).pipe(
    Effect.mapError((): CacheFailure => "invalid"),
  );
  if (!(yield* signatureValid(envelope, keys))) return yield* Effect.fail<CacheFailure>("invalid");
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DependencyAllowlist))(
    envelope.payload,
  ).pipe(Effect.mapError((): CacheFailure => "invalid"));
});

const noAllowlist = {
  refresh: Effect.succeed(Option.none<DependencyAllowlist>()),
  cached: Effect.succeed(Option.none<DependencyAllowlist>()),
};

export class Allowlist extends Context.Service<
  Allowlist,
  {
    /** `makeCachedFetch` keeps the last verified allowlist when a refresh fails. */
    readonly refresh: Effect.Effect<Option.Option<DependencyAllowlist>>;
    /** The last verified allowlist at any age, with no request. */
    readonly cached: Effect.Effect<Option.Option<DependencyAllowlist>>;
  }
>()("stacks/Allowlist") {
  static layer = ({ keys }: { keys: typeof INDEX_PUBLIC_KEYS }) =>
    Layer.effect(
      Allowlist,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* HttpClient.HttpClient;
        const config = yield* AppConfig;
        const apiUrl = yield* config.apiUrl;
        // Without a key nothing could verify, so a release build with no published keys never fetches.
        if (apiUrl === undefined || keys.length === 0) return noAllowlist;
        const cache = { fs, path, root: (yield* config.paths).cache };
        const url = new URL("v1/allowlist.json", `${apiUrl.replace(/\/$/, "")}/`).href;
        const resource = yield* makeCachedFetch({
          cache,
          client,
          url,
          bodyFile: "allowlist.json",
          stateFile: "allowlist.state.json",
          decode: (text) => verifyAllowlist(text, keys),
          offline: config.offline,
        });
        return { refresh: resource.current(), cached: resource.cached };
      }),
    );
}
