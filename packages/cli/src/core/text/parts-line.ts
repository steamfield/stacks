/** The one-line text rendering of a workspace's parts, which `new` and `show` both print. */
import type { ResultPart } from "../../schemas/part";

/** `Parts: backend (api, api-part), frontend (web, web-part)`: directory, role and stack. */
export const partsLine = (parts: ReadonlyArray<ResultPart>): string =>
  `Parts: ${parts.map((part) => `${part.name} (${part.role}, ${part.stack})`).join(", ")}`;
