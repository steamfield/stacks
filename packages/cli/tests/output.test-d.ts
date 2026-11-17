import { expectTypeOf, test } from "vitest";
import type { PreparedFailure, Usage } from "../src/errors";
import type { Output } from "../src/services/output";

test("Output.error rejects structural lookalikes with unchecked details", () => {
  type FailureArgument = Parameters<Output["Service"]["error"]>[0];
  type UncheckedFailure = Pick<PreparedFailure, keyof PreparedFailure> & {
    error: Usage;
    details: { extra: string };
    invocation: string;
  };
  expectTypeOf<PreparedFailure>().toExtend<FailureArgument>();
  expectTypeOf<UncheckedFailure>().not.toExtend<FailureArgument>();
});
