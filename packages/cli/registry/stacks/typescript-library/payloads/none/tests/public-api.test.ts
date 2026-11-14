// Pins the public API: the names src/index.ts exports at runtime. A change here is a release
// decision (a new export is minor, a removed or renamed one is major), so update README.md's API
// section in the same change. Add type tests (expectTypeOf, and a @ts-expect-error case for what
// callers must not pass) with the first export; `bun run typecheck` checks them.
import { expect, test } from "vitest";
import * as api from "../src/index.ts";

test("exports exactly the documented names", () => {
  expect(Object.keys(api).sort()).toEqual([]);
});
