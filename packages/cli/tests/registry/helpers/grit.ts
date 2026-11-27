import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../helpers/cli";

const pkg = join(import.meta.dirname, "../../..");

/** Lints `source` written to `path` under a temporary root with only the boundary plugin. */
export function lint(path: string, source: string, plugin = "biome-plugins/boundaries.grit") {
  const dir = tempDir();
  try {
    mkdirSync(join(dir.path, path, ".."), { recursive: true });
    writeFileSync(join(dir.path, "biome.json"), JSON.stringify({ plugins: [join(pkg, plugin)] }));
    const file = join(dir.path, path);
    writeFileSync(file, `${source}\n`);
    return spawnSync(join(pkg, "node_modules/.bin/biome"), ["lint", file], {
      cwd: dir.path,
      encoding: "utf8",
    });
  } finally {
    dir.cleanup();
  }
}
