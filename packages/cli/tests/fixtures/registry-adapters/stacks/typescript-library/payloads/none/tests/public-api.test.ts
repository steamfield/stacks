/**
 * Pins the empty public entry so new exports require an explicit API and release decision.
 * With the first export, add signature and negative type cases alongside README.md API updates;
 * bun run typecheck checks those types.
 */

import { expect, test } from "vitest";
import * as api from "../src/index.ts";

test("exports exactly the documented names", () => {
  expect(Object.keys(api).sort()).toEqual([]);
});
