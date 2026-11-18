/**
 * Fills command table markers in shipped Markdown using entry metadata alone. In a workspace, a
 * command a mounted entry declared is written as it runs: in its part's directory, with the
 * part's own runner, since the workspace's runner doesn't have the part's targets.
 */
import type { RenderedFile } from "../compose/files";
import type { Composition, MountedEntry } from "../compose/types";
import type { Entry } from "../registry/entry";

const COMMANDS_MARKER = /^[ \t]*<!--\s*stacks:fill:commands\b.*-->[ \t]*\r?$/;

type Runner = "make" | "bun run";
/** A mounted command: the part directory it runs in, its unprefixed name, and the part's runner. */
type PartCommand = { dir: string; name: string; run: Runner | undefined };

/**
 * How the stack's commands run: Makefile targets, else package scripts through Bun. Undefined
 * when neither tag says, and the marker stays for the agent.
 */
function runner(stack: Entry | null): Runner | undefined {
  const tags = stack?.meta.tags ?? [];
  if (tags.includes("make")) return "make";
  if (tags.includes("scripts") && tags.includes("bun")) return "bun run";
  return undefined;
}

/**
 * Each command key a part or a fragment placed on one declared, as `mountEntry` prefixed it. A key
 * the workspace declares itself was dropped from the mounted meta, so it stays the workspace's.
 */
function partCommands(composition: Composition<Entry | null>): Map<string, PartCommand> {
  const parts = composition.parts ?? [];
  const mounted: MountedEntry[] = [
    ...parts.flatMap((part) => (part.entry ? [part.entry] : [])),
    ...composition.fragments,
  ];
  const commands = new Map<string, PartCommand>();
  for (const { mount, meta } of mounted) {
    if (!mount) continue;
    const run = runner(parts.find((part) => part.mount.name === mount.name)?.entry ?? null);
    for (const key of Object.keys(meta.commands))
      commands.set(key, { dir: mount.name, name: key.slice(mount.name.length + 1), run });
  }
  return commands;
}

/** The command line for one table row; a part without a known runner keeps the workspace's. */
function invocation(key: string, run: Runner, part: PartCommand | undefined): string {
  if (!part?.run) return `${run} ${key}`;
  return part.run === "make"
    ? `make -C ${part.dir} ${part.name}`
    : `cd ${part.dir} && ${part.run} ${part.name}`;
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
  const parts = partCommands(composition);
  const rows = commands.map(
    ([key, purpose]) => `| \`${invocation(key, run, parts.get(key))}\` | ${cell(purpose)} |`,
  );
  return files.map((file) => fillFile(file, rows));
}
