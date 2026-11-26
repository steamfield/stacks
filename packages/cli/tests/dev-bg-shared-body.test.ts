import { globSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { expect, test } from "vitest";

function expectSharedBody(registry: string) {
  const script = "files/scripts/dev-bg.sh";
  const scripts = globSync(`*/${script}`, { cwd: join(registry, "stacks") })
    .map((file) => file.slice(0, file.indexOf(sep)))
    .sort()
    .map((id) => {
      const file = join("stacks", id, script);
      // Latin-1 preserves every byte, including line endings in the body.
      const source = readFileSync(join(registry, file), "latin1");
      const parts = source.split(/(?<=^|\n)# --- shared body ---(?:\r?\n|$)/);
      return { file, markers: parts.length - 1, body: parts[1] };
    });
  expect(
    scripts.filter(({ markers }) => markers !== 1).map(({ file, markers }) => ({ file, markers })),
    "Each dev-bg.sh must contain exactly one # --- shared body --- line",
  ).toEqual([]);

  const [first, ...rest] = scripts;
  if (!first) return;
  expect(
    rest.filter(({ body }) => body !== first.body).map(({ file }) => file),
    `Shared body differs from ${first.file}`,
  ).toEqual([]);
}

test("bundled dev-bg scripts mark one byte-identical shared body", () => {
  expectSharedBody(join(import.meta.dirname, "..", "registry"));
});
