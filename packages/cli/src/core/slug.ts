/**
 * The one slug rule: strip an npm scope, fold accents, split camelCase,
 * then join ASCII words with dashes. Use `project` when no ASCII word remains.
 */
export function slug(name: string): string {
  return (
    name
      .replace(/^@[^/]+\//, "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** The slug upper-cased with `-` turned to `_`, prefixed `_` when it starts with a digit. */
export function envPrefix(slugged: string): string {
  const upper = slugged.toUpperCase().replaceAll("-", "_");
  return /^[0-9]/.test(upper) ? `_${upper}` : upper;
}
