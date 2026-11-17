/**
 * Fills project values in shipped templates. Fixed substitutions keep shipped files static
 * apart from project values. Unknown names fail with advice ordered by `TEMPLATE_VARIABLES`.
 */
import { hasControl } from "./text/text";

/** The fixed template variables. No entry can add one. */
export const TEMPLATE_VARIABLES = [
  "project_name",
  "project_slug",
  "env_prefix",
  "package_scope",
  "author",
  "year",
] as const;
type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Record<TemplateVariable, string>;

/**
 * The `author` value from a raw name (the setting, or git's user.name): `"`, `\` and line breaks
 * removed, since templates insert it raw into JSON strings and YAML; `undefined` when it still
 * holds another control character.
 */
export function authorValue(raw: string): string | undefined {
  const value = raw.replace(/["\\\r\n]/g, "");
  return hasControl(value) ? undefined : value;
}

/**
 * The one token: `{{`, optional spaces or tabs, an identifier, optional spaces or tabs, `}}`,
 * leftmost first and never across a line break. Anything else is literal text, so
 * `${{ secrets.X }}` passes through and `${{{project_slug}}}` renders the slug inside `${...}`.
 */
const TOKEN = /\{\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}\}/g;

const known = (name: string): name is TemplateVariable =>
  (TEMPLATE_VARIABLES as ReadonlyArray<string>).includes(name);

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * A `.tmpl` file's text with every token replaced, or the first unknown name and its 1-based
 * line.
 */
export function renderTemplate(
  text: string,
  values: TemplateValues,
): { text: string } | { unknown: string; line: number } {
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1] ?? "";
    if (!known(name) || typeof values[name] !== "string")
      return { unknown: name, line: lineAt(text, match.index) };
  }
  // Every token is known by now; the `known` check only narrows the name's type.
  return { text: text.replace(TOKEN, (_, name: string) => (known(name) ? values[name] : "")) };
}
