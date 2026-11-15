/**
 * The one line `stacks update` prints in text mode for each outcome of `update.ts::update`.
 *
 * `commands/update.ts` prints this line for the human and agent audiences; `--json` prints the
 * `UpdateResult` itself. The wording is user-visible, so agents may match on it.
 */
import type { UpdateResult } from "../../schemas/update";

/** The text line for an update result. */
export function renderUpdate(result: UpdateResult): string {
  switch (result.status) {
    case "up-to-date":
      return `stacks ${result.current} is up to date.`;
    case "ahead":
      return `stacks ${result.current} is newer than the published ${result.latest}.`;
    case "available":
      return `stacks ${result.latest} is available (running ${result.current}). Run: ${result.command}`;
    case "updated":
      return `Updated stacks ${result.current} -> ${result.latest}.`;
  }
}
