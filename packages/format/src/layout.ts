/**
 * Where an entry's bundle files land in a project. A bundle path is entry-relative
 * (`files/README.md.tmpl`, `adapters/claude/.claude/settings.json`); its shipped path drops the
 * `files/`, agent adapter, stack overlay or payload prefix, and its output path also drops a
 * `.tmpl` suffix. The CLI and the website both map files with these functions.
 */

const OVERLAY_KINDS = { adapters: "agent", stacks: "stack", payloads: "payload" } as const;

/** The selection that ships an overlay file: one agent, one host stack or one payload variant. */
export type ShippedCondition = {
  readonly kind: (typeof OVERLAY_KINDS)[keyof typeof OVERLAY_KINDS];
  readonly id: string;
};

/** A bundle file's project path and the selection that ships it (`null`: always shipped). */
export type Shipped = { readonly path: string; readonly condition: ShippedCondition | null };

/**
 * Map an entry-relative source to its project path and the selection that ships it; `undefined`
 * for a file that never ships (the entry's markdown file, anything outside the shipped trees).
 */
export function shippedPath(source: string): Shipped | undefined {
  const shared = /^files\/(.+)$/.exec(source);
  if (shared?.[1]) return { path: shared[1], condition: null };
  const overlay = /^(adapters|stacks|payloads)\/([^/]+)\/(.+)$/.exec(source);
  const kind = overlay?.[1] as keyof typeof OVERLAY_KINDS | undefined;
  if (!overlay?.[2] || !overlay[3] || !kind) return undefined;
  return { path: overlay[3], condition: { kind: OVERLAY_KINDS[kind], id: overlay[2] } };
}

/** Output path of a shipped path; a literal `.tmpl` basename is copied unchanged. */
export function outputPath(path: string): string {
  const suffix = ".tmpl";
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(suffix) && base.length > suffix.length
    ? path.slice(0, -suffix.length)
    : path;
}
