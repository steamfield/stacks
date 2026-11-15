import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaces } from "../../../package.json";
import metadata from "../package.json";

// Stage only the published interface. Workspace source conditions and tooling never ship.
const staging = mkdtempSync(join(tmpdir(), "stacks-format-pack-"));
try {
  cpSync("dist", join(staging, "dist"), {
    recursive: true,
    filter: (path) => !path.endsWith("/pack"),
  });
  cpSync("LICENSE", join(staging, "LICENSE"));
  cpSync("schemas", join(staging, "schemas"), { recursive: true });
  const packed = {
    name: metadata.name,
    version: metadata.version,
    type: metadata.type,
    license: metadata.license,
    repository: metadata.repository,
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    files: metadata.files,
    dependencies: { effect: workspaces.catalog.effect },
  };
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(packed, null, 2)}\n`);
  rmSync("dist/pack", { recursive: true, force: true });
  const result = Bun.spawnSync(
    ["bun", "pm", "pack", "--destination", join(process.cwd(), "dist/pack")],
    {
      cwd: staging,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
} finally {
  rmSync(staging, { recursive: true, force: true });
}
