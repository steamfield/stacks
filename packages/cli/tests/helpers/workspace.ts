import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quiet, runCli } from "./cli";

type CliResult = Awaited<ReturnType<typeof runCli>>;

/** The shared workspace fixture registry: a workspace stack `pair` over `api-part` and `web-part`. */
export const workspaceRegistry = join(import.meta.dirname, "..", "fixtures", "registry-workspace");

/** A temp copy of the fixture, edited by `edit`, for failure-case variants; `cleanup` removes it. */
export function workspaceVariant(edit?: (root: string) => void): {
  root: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "stacks-workspace-"));
  const root = join(dir, "registry");
  cpSync(workspaceRegistry, root, { recursive: true });
  edit?.(root);
  return { root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * `stacks new pair <target> --no-launch --json` over `root` (default the fixture): the CLI's
 * result and the target directory. The target's parent is a fresh temp HOME the caller removes.
 */
export async function newWorkspace(
  options: { root?: string; args?: string[] } = {},
): Promise<{ result: CliResult; target: string }> {
  const home = mkdtempSync(join(tmpdir(), "stacks-workspace-home-"));
  const target = join(home, "app");
  const result = await runCli(
    ["new", "pair", target, "--no-launch", "--json", ...(options.args ?? [])],
    {
      home,
      env: { ...quiet, PATH: process.env.PATH ?? "" },
      host: { registry: options.root ?? workspaceRegistry },
    },
  );
  return { result, target };
}
