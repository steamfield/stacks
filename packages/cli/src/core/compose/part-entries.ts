/**
 * The two readings of a workspace's parts that several modules share: a composition's stack-kind
 * entries, whose order the brief, proof and fingerprint depend on, and the mounts a project's
 * manifest records.
 */
import type { Manifest } from "@steamfield/stacks-format";
import type { ComposedPart, MountedEntry, PartMount } from "./types";

/**
 * The composed stack-kind entries: the stack (the workspace, in a workspace), then each part's
 * entry in `parts` order, skipping a part the registry no longer has. Fingerprints hash this
 * order, so it never changes.
 */
export function stackEntries(
  stack: MountedEntry | null,
  parts: ReadonlyArray<ComposedPart> | undefined,
): ReadonlyArray<MountedEntry> {
  return [
    ...(stack ? [stack] : []),
    ...(parts ?? []).flatMap((part) => (part.entry ? [part.entry] : [])),
  ];
}

/** The parts a project records in `Manifest.parts`, as compose mounts them (`stack` is the ref's id). */
export function manifestMounts(parts: Manifest["parts"]): ReadonlyArray<PartMount> {
  return (parts ?? []).map(({ name, role, stack }) => ({ name, role, stack: stack.id }));
}
