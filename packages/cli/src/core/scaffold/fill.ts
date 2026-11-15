/** Fills the `stacks:fill:commands` markers in shipped Markdown from the composition's commands. */
import type { RenderedFile } from "../compose/files";
import type { Composition } from "../compose/types";
import type { Entry } from "../registry/entry";

/** A line that is only a commands marker: `<!-- stacks:fill:commands ... -->`. */
const COMMANDS_MARKER = /^[ \t]*<!--\s*stacks:fill:commands\b.*-->[ \t]*\r?$/;

/**
 * How the stack's commands run: Makefile targets, else package scripts through Bun. Undefined
 * when neither tag says, and the marker stays for the agent.
 */
function runner(stack: Entry | null): string | undefined {
  const tags = stack?.meta.tags ?? [];
  if (tags.includes("make")) return "make";
  if (tags.includes("scripts") && tags.includes("bun")) return "bun run";
  return undefined;
}

/** Text for one Markdown table cell: whitespace collapsed to single spaces, pipes escaped. */
const cell = (text: string) => text.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");

/** `file` with each marker line replaced by `rows`; the same object when it has no marker. */
function fillFile(file: RenderedFile, rows: ReadonlyArray<string>): RenderedFile {
  if (!/\.md$/i.test(file.path)) return file;
  const lines = new TextDecoder().decode(file.bytes).split("\n");
  if (!lines.some((line) => COMMANDS_MARKER.test(line))) return file;
  const filled = lines.flatMap((line) => (COMMANDS_MARKER.test(line) ? rows : [line]));
  return { ...file, bytes: new TextEncoder().encode(filled.join("\n")) };
}

/**
 * Replace each commands marker in shipped Markdown with one table row per declared command. This
 * is the one marker stacks fills: the rows come from the entries' `commands:`, with nothing run.
 */
export function fillMarkers(
  files: ReadonlyArray<RenderedFile>,
  composition: Composition<Entry | null>,
): RenderedFile[] {
  const run = runner(composition.stack);
  const commands = Object.entries(composition.commands);
  if (!run || !commands.length) return [...files];
  const rows = commands.map(([name, purpose]) => `| \`${run} ${name}\` | ${cell(purpose)} |`);
  return files.map((file) => fillFile(file, rows));
}
