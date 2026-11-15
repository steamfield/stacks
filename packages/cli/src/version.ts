/**
 * The CLI's name and version, read from its own `package.json` when Bun bundles the CLI.
 *
 * `stacks --version`, `doctor`, telemetry and the npx form of error hints (`invocation.ts`) read
 * these. `SLUG` is the directory name the CLI uses under each XDG location (`config.ts`).
 */
import metadata from "../package.json";
export const PACKAGE = metadata.name;
export const VERSION = metadata.version;
export const SLUG = "stacks";
