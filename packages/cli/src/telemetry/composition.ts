/**
 * Checks add telemetry facts against the registry so editing a manifest cannot make a custom
 * composition look official. New already built its own manifest in the current invocation.
 */
import type { EntryRef, Manifest, StackPart } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { compose } from "../core/compose/compose";
import { fingerprint } from "../core/fingerprint";
import { Registry } from "../core/registry/registry";
import { manifestEntries, official, type ScaffoldFacts } from "./events";

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
  const parts = yield* resolveParts(registry, input.manifest.parts);
  const fragments = yield* Effect.forEach(input.manifest.fragments, (ref) =>
    resolve({ registry, kind: "fragment", ref }),
  );
  const { fingerprint: _claimed, ...unclaimed } = input.manifest;
  const manifest: Manifest = { ...unclaimed, stack, ...parts, fragments };
  if (!stack || !manifestEntries(manifest).every(official)) return { ...input, manifest };
  const recomputed = yield* officialFingerprint({ registry, stack, manifest });
  if (recomputed === undefined) return { ...input, manifest };
  return { ...input, manifest: { ...manifest, fingerprint: recomputed } };
});

/** Each part's stack ref re-resolved, so an edited `Manifest.parts` origin can't claim official. */
const resolveParts = (registry: Registry["Service"], parts: Manifest["parts"]) =>
  parts === undefined
    ? Effect.succeed({})
    : Effect.forEach(parts, (part) =>
        Effect.map(resolve({ registry, kind: "stack", ref: part.stack }), (stack) => ({
          ...part,
          stack,
        })),
      ).pipe(Effect.map((resolved): Pick<Manifest, "parts"> => ({ parts: resolved })));

/** Whether the registry workspace mounts the manifest's parts: the same names and stack ids, in order. */
const sameParts = (declared: ReadonlyArray<StackPart>, recorded: Manifest["parts"]) => {
  const key = (parts: ReadonlyArray<{ name: string; stack: string }>) =>
    JSON.stringify(parts.map(({ name, stack }) => [name, stack]));
  return key(declared) === key((recorded ?? []).map((part) => ({ ...part, stack: part.stack.id })));
};

/**
 * Composes the stack with the manifest's fragments, leaving out every default fragment the
 * manifest doesn't list, and fingerprints the result. Returns `undefined` when the composition
 * pulls in a fragment the manifest doesn't list, or the registry workspace's parts differ from
 * the manifest's, since the fingerprint would then describe a different project.
 */
const officialFingerprint = Effect.fn("telemetry.officialFingerprint")(function* (input: {
  registry: Registry["Service"];
  stack: EntryRef;
  manifest: Manifest;
}) {
  const { manifest, stack } = input;
  const entry = yield* input.registry.get("stack", stack.id);
  if (entry.meta.kind !== "stack") return undefined;
  if (!sameParts(entry.meta.parts ?? [], manifest.parts)) return undefined;
  const defaults = entry.meta.fragments.default;
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
