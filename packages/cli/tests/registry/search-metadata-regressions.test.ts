import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { bundled } from "./helpers/bundled";

test("every bundled card is byte for byte what decorate writes, so approving changes one line", async () => {
  const { readdirSync } = await import("node:fs");
  const { Schema } = await import("effect");
  const { SearchMetadata } = await import("@steamfield/stacks-format");
  for (const kind of ["stack", "fragment"] as const) {
    for (const name of readdirSync(join(bundled, "search", `${kind}s`))) {
      const text = readFileSync(join(bundled, "search", `${kind}s`, name), "utf8");
      const decoded = Schema.decodeUnknownSync(SearchMetadata)(JSON.parse(text));
      expect(text, name).toBe(`${JSON.stringify(decoded, null, 2)}\n`);
    }
  }
});
