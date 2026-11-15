/**
 * The shape of what `stacks update --json` prints. `update` compares this copy's version with the
 * latest on npm (`core/update/update.ts`). `status` picks the shape: `up-to-date` or `ahead` need
 * nothing, `available` names how this copy was installed and the command that would upgrade it,
 * and `updated` means a global npm install was upgraded in place.
 */
import { Schema } from "effect";
import { NoticeFields } from "./notice";

/** The fields every status shares. */
const Versions = { ...NoticeFields, current: Schema.String, latest: Schema.String };

export const UpdateResult = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["up-to-date", "ahead"]), ...Versions }),
  Schema.Struct({
    status: Schema.Literal("available"),
    ...Versions,
    install: Schema.Literals(["npm-global", "npx", "other"]),
    command: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("updated"),
    ...Versions,
    install: Schema.Literal("npm-global"),
  }),
]);
export type UpdateResult = typeof UpdateResult.Type;
