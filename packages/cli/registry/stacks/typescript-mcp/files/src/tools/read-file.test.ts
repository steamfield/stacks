import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { tempRoot } from "../../tests/helpers/server.ts";
import { ToolError } from "../errors.ts";
import { readFileUnderRoot } from "./read-file.ts";

let root: string;
let cleanup: () => void;
beforeEach(() => {
  ({ root, cleanup } = tempRoot());
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/a.md"), "# A\n");
  writeFileSync(join(root, "big.txt"), "x".repeat(101));
  writeFileSync(join(root, "image.bin"), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
  symlinkSync(join(root, "docs/a.md"), join(root, "inside-link.md"));
});
afterEach(() => cleanup());

const read = (path: string) => readFileUnderRoot(root, path, 100);

test.each([
  ["docs/a.md", "# A\n"],
  ["./docs/a.md", "# A\n"],
  ["docs/../docs/a.md".replace("../docs/", ""), "# A\n"],
  ["inside-link.md", "# A\n"],
])("%s reads the file", async (path, text) => {
  expect(await read(path)).toEqual({ path, bytes: Buffer.byteLength(text), text });
});

test.each([
  ["../a.md", "invalid_path"],
  ["docs/../../a.md", "invalid_path"],
  ["docs\\..\\..\\a.md", "invalid_path"],
  ["/etc/hosts", "invalid_path"],
  ["C:/Windows/win.ini", "invalid_path"],
  ["missing.md", "not_found"],
  ["docs/a.md/child", "not_found"],
  ["docs", "not_a_file"],
  ["big.txt", "too_large"],
  ["image.bin", "not_text"],
])("%s is the %s tool error", async (path, code) => {
  await expect(read(path)).rejects.toEqual(expect.objectContaining({ code }));
  await expect(read(path)).rejects.toBeInstanceOf(ToolError);
});

test("a symbolic link leaving the root is outside_root", async () => {
  const outside = tempRoot();
  try {
    writeFileSync(join(outside.root, "secret.txt"), "secret");
    symlinkSync(outside.root, join(root, "escape"));
    await expect(read("escape/secret.txt")).rejects.toEqual(
      expect.objectContaining({ code: "outside_root" }),
    );
  } finally {
    outside.cleanup();
  }
});
