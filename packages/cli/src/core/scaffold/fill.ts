/** Fills command table markers in shipped Markdown using entry metadata alone. */
import type { RenderedFile } from "../compose/files";
import type { Composition } from "../compose/types";
import type { Entry } from "../registry/entry";

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

/** Preserve the original file and bytes when there is no Markdown commands marker. */
function fillFile(file: RenderedFile, rows: ReadonlyArray<string>): RenderedFile {
  if (!/\.md$/i.test(file.path)) return file;
  const lines = new TextDecoder().decode(file.bytes).split("\n");
  if (!lines.some((line) => COMMANDS_MARKER.test(line))) return file;
  const filled = lines.flatMap((line) => (COMMANDS_MARKER.test(line) ? rows : [line]));
  return { ...file, bytes: new TextEncoder().encode(filled.join("\n")) };
}

/** Fill the commands marker from entry metadata alone. The declared commands never run here. */
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
