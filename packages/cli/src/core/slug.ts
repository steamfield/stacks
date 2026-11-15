/**
 * Turns a project name into the safe identifiers templates and the brief use.
 *
 * `stacks new --name "My App"` needs a directory name, a package name and an environment variable
 * prefix that every tool accepts. `slug` gives `my-app` and `envPrefix` gives `MY_APP`.
 * `scaffold/values.ts` fills the `project_slug` and `env_prefix` template values from them,
 * `brief/render.ts` prints them in the brief, and `add/name.ts`, `prompting.ts` and
 * `scaffold/new.ts` derive names and default directories with `slug`. Keeping one rule here means
 * the directory, the files and the brief always agree.
 */

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
