import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { cliMeetsMinimum } from "../../src/core/registry/remote/verification";
import { RegistryMeta } from "../../src/schemas/registry-meta";
import { bundled } from "./helpers/bundled";

// A release without `--min-cli` keeps the floor, so the shipped minimum may trail VERSION.
test("the shipped registry declares a minimum this CLI meets", () => {
  const contents = readFileSync(join(bundled, "registry.json"), "utf8");
  const shipped = Schema.decodeUnknownSync(Schema.fromJsonString(RegistryMeta))(contents, {
    onExcessProperty: "error",
  });

  expect(shipped.minCli).toMatch(/^\d+\.\d+\.\d+$/);
  expect(cliMeetsMinimum(shipped.minCli)).toBe(true);
});
