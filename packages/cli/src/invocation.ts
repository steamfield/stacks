/**
 * Works out how the person or agent started the CLI, so hints such as `Next:` lines name a
 * command they can paste back.
 *
 * `bin.ts` calls `invocationFor` with the script path Node ran and stores the answer as
 * `Host.invocation`. Run through `npx`, the CLI isn't on PATH, so a hint that said `stacks` would
 * fail; the npx form pins this exact version instead. This module is unrelated to the
 * `Invocation` service in `services/invocation.ts`, which carries a command's exit status to
 * `main`.
 */
import { PACKAGE, VERSION } from "./version";

/** npm's cache path identifies an npx invocation, including a symlinked package bin. */
export const isNpxPath = (path: string): boolean => path.split("/").includes("_npx");

/** The command a hint should name: `stacks`, or `npx -y <package>@<version>` under npx. */
export const invocationFor = (script: string): string =>
  isNpxPath(script) ? `npx -y ${PACKAGE}@${VERSION}` : "stacks";
