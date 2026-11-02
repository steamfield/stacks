import { Schema } from "effect";
import { ListResult, NewResult, VerifyResult } from "./cli";

const AbsoluteDir = Schema.String.check(Schema.isPattern(/^\//u));

export const ListParams = Schema.Struct({
  group: Schema.optionalKey(Schema.Literals(["stacks", "fragments", "apps"])),
});
export type ListParams = typeof ListParams.Type;
export const ListSuccess = ListResult;
export type ListSuccess = typeof ListSuccess.Type;

export const NewParams = Schema.Struct({
  stack: Schema.String,
  dir: AbsoluteDir,
  preset: Schema.optionalKey(Schema.Literals(["default", "sandbox"])),
  with: Schema.optionalKey(Schema.Array(Schema.String)),
  without: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type NewParams = typeof NewParams.Type;
export const NewSuccess = NewResult;
export type NewSuccess = typeof NewSuccess.Type;

export const VerifyParams = Schema.Struct({ dir: AbsoluteDir });
export type VerifyParams = typeof VerifyParams.Type;
export const VerifySuccess = Schema.Struct({
  ...VerifyResult.fields,
  next: Schema.optionalKey(Schema.String),
});
export type VerifySuccess = typeof VerifySuccess.Type;
