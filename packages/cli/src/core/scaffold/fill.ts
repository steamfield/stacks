import type { Composition } from "../compose/compose";
import type { RenderedFile } from "../compose/files";
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

const cell = (text: string) => text.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");

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
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return files.map((file) => {
    if (!/\.md$/i.test(file.path)) return file;
    const text = decoder.decode(file.bytes);
    const lines = text.split("\n");
    if (!lines.some((line) => COMMANDS_MARKER.test(line))) return file;
    const filled = lines.flatMap((line) => (COMMANDS_MARKER.test(line) ? rows : [line]));
    return { ...file, bytes: encoder.encode(filled.join("\n")) };
  });
}
