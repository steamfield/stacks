import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { MANIFEST_PATH } from "../../src/core/project/manifest";
import { quiet, runCli, tempDir } from "./cli";
import { minimal, writeEntry } from "./registry";

export const PICKER_PROMPT =
  "Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when stacks verify passes.";
export const pickerTTY = { stdinIsTTY: true, stdoutIsTTY: true };

/** Small trusted registry and a PATH containing real git but no installed coding agents. */
export function pickerWorkspace() {
  const dir = tempDir();
  const home = realpathSync(dir.path);
  const registry = join(home, "registry");
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync("/usr/bin/git", join(bin, "git"));
  const stack = writeEntry({
    root: registry,
    kind: "stack",
    dir: "picker-stack",
    frontmatter: minimal(
      "stack",
      "picker-stack",
      'verify:\n  - { name: picker-check, phase: check, run: "git status --short" }',
    ),
  });
  mkdirSync(join(stack, "files"));
  writeFileSync(join(stack, "files", "README.md"), "# Picker project\n");
  const fragment = writeEntry({
    root: registry,
    kind: "fragment",
    dir: "picker-extra",
    frontmatter: minimal("fragment", "picker-extra"),
  });
  mkdirSync(join(fragment, "files"));
  writeFileSync(join(fragment, "files", "extra.txt"), "added\n");
  return { home, registry, bin, project: join(home, "app"), cleanup: dir.cleanup };
}
export type PickerWorkspace = ReturnType<typeof pickerWorkspace>;

export function pickerCli(
  workspace: PickerWorkspace,
  args: readonly string[],
  options: Parameters<typeof runCli>[1] = {},
) {
  return runCli(args, {
    ...options,
    home: workspace.home,
    env: {
      ...quiet,
      PATH: workspace.bin,
      XDG_STATE_HOME: join(workspace.home, "state"),
      XDG_DATA_HOME: join(workspace.home, "data"),
      GIT_CONFIG_NOSYSTEM: "1",
      ...options.env,
    },
    host: { registry: workspace.registry, cwd: workspace.home, ...pickerTTY, ...options.host },
  });
}
export function pickerNew(
  workspace: PickerWorkspace,
  args: readonly string[] = [],
  options: Parameters<typeof runCli>[1] = {},
) {
  return pickerCli(workspace, ["new", "picker-stack", "app", "--sandbox", ...args], options);
}
export const pickerManifest = (project: string) =>
  Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(project, MANIFEST_PATH), "utf8")),
    { onExcessProperty: "error" },
  );
