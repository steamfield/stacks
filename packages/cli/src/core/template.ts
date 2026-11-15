/**
 * Fills the `{{ name }}` tokens in an entry's `.tmpl` files with the project's values.
 *
 * A stack or fragment may ship a file ending in `.tmpl`; when `stacks new` or `stacks add` writes
 * it, the suffix is dropped and each token is replaced by one of a fixed set of values (the
 * project's name, slug, env prefix, package scope, author and year). `compose/files.ts` calls
 * `renderTemplate` for every such file, `scaffold/values.ts` builds the values, and
 * `validate/templates.ts` checks entries for unknown names ahead of time.
 *
 * The language is deliberately tiny: substitution only, with no conditionals, loops or
 * entry-defined variables, because stacks ship static files and is not a template engine
 * (`.claude/rules/architecture.md`, "Product constraints"). An unknown name fails the render
 * instead of printing as empty, and
 * `TEMPLATE_VARIABLES` appears in that error's advice, so its order is user-visible.
 */
import { hasControl } from "./text";

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

/** The 1-based line number of the character at `index`. */
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * A `.tmpl` file's text with every token replaced, or the first unknown name and its 1-based
 * line. Substitution only: there are no conditionals or loops.
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
