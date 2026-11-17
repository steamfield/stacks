/** Owns update's text wording, which callers may match when handling an outcome. */
import type { UpdateResult } from "../../schemas/update";

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
