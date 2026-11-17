/**
 * Builds the command name users can paste from a hint. The version-pinned npx form works when
 * the invoked binary has no standalone command on PATH.
 */
import { PACKAGE, VERSION } from "./version";

/** npm's cache path identifies an npx invocation, including a symlinked package bin. */
export const isNpxPath = (path: string): boolean => path.split("/").includes("_npx");

/** The command a hint should name: `stacks`, or `npx -y <package>@<version>` under npx. */
export const invocationFor = (script: string): string =>
  isNpxPath(script) ? `npx -y ${PACKAGE}@${VERSION}` : "stacks";
