/**
 * Reads the process's working directory for `bin.ts`, which puts it in `Host.cwd`. It lives here
 * because only `bin.ts` and `platform/` may touch `process`.
 */
import { Option } from "effect";

/**
 * The process's working directory, or none when it was removed after the shell entered it.
 * Node's `process.cwd()` throws ENOENT (`uv_cwd`) then; any other failure is unexpected and
 * still throws.
 */
export function workingDirectory(): Option.Option<string> {
  try {
    return Option.some(process.cwd());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return Option.none();
    throw error;
  }
}
