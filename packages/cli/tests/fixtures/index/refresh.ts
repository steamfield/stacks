import { type KeyLike, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RegistryIndex, SignedIndex } from "@steamfield/stacks-format";
import { Effect, Fiber } from "effect";
import { onTestFinished } from "vitest";
import { tempDir } from "../../helpers/cli";
import { remoteServer } from "../../helpers/remote-index";
import { keyId, privateKey } from "./harness";

export const indexPath = "/v1/index.json";
export const indexEtag = '"registry-v1"';
export const index = {
  formatVersion: 1,
  minCli: "0.14.0",
  commit: "a".repeat(40),
  generatedAt: "2026-11-25T12:34:56.000Z",
  entries: [],
} satisfies RegistryIndex;

export function signIndex(value: unknown, id = keyId, key: KeyLike = readFileSync(privateKey)) {
  const payload = JSON.stringify(value);
  const signature = sign(null, Buffer.from(payload), key).toString("base64");
  return { keyId: id, payload, signature } satisfies SignedIndex;
}

export function remoteTestDirectory() {
  const dir = tempDir();
  let close: (() => Promise<void>) | undefined;
  onTestFinished(async () => {
    try {
      await close?.();
    } finally {
      dir.cleanup();
    }
  });
  return {
    path: dir.path,
    async serve(root: string) {
      const server = await remoteServer(root);
      close = server.close;
      return server;
    },
  };
}

/** Observe real fetch headers, with an optional gate before delivering the response to Effect. */
export function observeResponse(hold = false) {
  const received = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  if (!hold) ready.resolve();
  onTestFinished(() => ready.resolve());
  const fetch = new Proxy(globalThis.fetch, {
    async apply(target, _receiver, args: Parameters<typeof globalThis.fetch>) {
      const response = await target(...args);
      received.resolve();
      await ready.promise;
      return response;
    },
  });
  return {
    fetch,
    release: ready.resolve,
    awaitHeaders: <A>(work: Fiber.Fiber<A>) =>
      Effect.raceFirst(
        Effect.promise(() => received.promise),
        Fiber.join(work).pipe(
          Effect.andThen(
            Effect.die(new Error("Request completed before response headers arrived")),
          ),
        ),
      ),
  };
}

/** A signed index with no bundle requests needed. */
export async function serveIndex() {
  const dir = remoteTestDirectory();
  const root = join(dir.path, "published");
  const home = join(dir.path, "home café");
  mkdirSync(home);
  mkdirSync(join(root, "v1"), { recursive: true });
  const write = (text: string) => writeFileSync(join(root, indexPath), text);
  write(JSON.stringify(signIndex(index)));
  return { home, server: await dir.serve(root), write };
}
