/**
 * Checks the facts an `add` telemetry event reports against the registry, so a hand-edited
 * manifest can't make a custom project look like an official one.
 *
 * `stacks add` reads the project's manifest (`.stacks/manifest.json`), which anyone can edit. Its
 * entry refs claim an origin and trust, and its fingerprint (a hash of the whole composition)
 * groups green rates per composition on the server. Before an `add` event is built,
 * `telemetry/index.ts` passes the manifest through `completeAddFacts`, which:
 *
 * 1. looks every stack and fragment id up in the registry and keeps the origin and trust found
 *    there, not the ones the manifest claims (an id the registry doesn't know becomes `unknown`);
 * 2. drops the manifest's fingerprint, and computes a fresh one only when every entry is official
 *    and composing the stack with exactly those fragments reproduces them.
 *
 * `new` events skip this: `stacks new` built the manifest in the same run.
 */
import type { EntryRef, Manifest } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { compose } from "../core/compose/compose";
import { fingerprint } from "../core/fingerprint";
import { Registry } from "../core/registry/registry";
import { official, type ScaffoldFacts } from "./events";

/** A manifest ref with the origin and trust the registry reports for its id. */
const resolve = Effect.fn("telemetry.resolveEntry")(function* (input: {
  registry: Registry["Service"];
  kind: "stack" | "fragment";
  ref: EntryRef;
}): Effect.fn.Return<EntryRef> {
  const entry = yield* input.registry.get(input.kind, input.ref.id).pipe(Effect.option);
  if (entry._tag === "None") return { id: input.ref.id, origin: "unknown", trusted: false };
  return { id: entry.value.id, origin: entry.value.origin, trusted: entry.value.trusted };
});

/** An edited manifest cannot authorize ids or reuse the original scaffold's fingerprint. */
export const completeAddFacts = Effect.fn("telemetry.completeAddFacts")(function* (
  input: ScaffoldFacts,
) {
  const registry = yield* Registry;
  const stack = input.manifest.stack
    ? yield* resolve({ registry, kind: "stack", ref: input.manifest.stack })
    : null;
  const fragments = yield* Effect.forEach(input.manifest.fragments, (ref) =>
    resolve({ registry, kind: "fragment", ref }),
  );
  const { fingerprint: _claimed, ...unclaimed } = input.manifest;
  const manifest: Manifest = { ...unclaimed, stack, fragments };
  const entries = [...(stack ? [stack] : []), ...fragments];
  if (!stack || !entries.every(official)) return { ...input, manifest };
  const recomputed = yield* officialFingerprint({ registry, stack, manifest });
  if (recomputed === undefined) return { ...input, manifest };
  return { ...input, manifest: { ...manifest, fingerprint: recomputed } };
});

/**
 * Composes the stack with the manifest's fragments, leaving out every default fragment the
 * manifest doesn't list, and fingerprints the result. Returns `undefined` when the composition
 * pulls in a fragment the manifest doesn't list, since the fingerprint would then describe a
 * different project.
 */
const officialFingerprint = Effect.fn("telemetry.officialFingerprint")(function* (input: {
  registry: Registry["Service"];
  stack: EntryRef;
  manifest: Manifest;
}) {
  const { manifest, stack } = input;
  const entry = yield* input.registry.get("stack", stack.id);
  const defaults = entry.meta.kind === "stack" ? entry.meta.fragments.default : [];
  const selected = new Set(manifest.fragments.map((fragment) => fragment.id));
  const composition = yield* compose({
    stack: stack.id,
    with: [...selected],
    without: defaults.filter((id) => !selected.has(id)),
    preset: manifest.preset,
    agents: manifest.agents,
    always: [],
    mode: "new",
  });
  if (composition.fragments.some((fragment) => !selected.has(fragment.id))) return undefined;
  return yield* fingerprint(composition);
});
