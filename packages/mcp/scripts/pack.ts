import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cli from "../../cli/package.json";
import metadata from "../package.json";

// Stage the runtime only, so old packs and development files cannot enter the archive.
const staging = mkdtempSync(join(tmpdir(), "stacks-mcp-pack-"));
const destination = join(process.cwd(), "dist/pack");
try {
  mkdirSync(join(staging, "dist"));
  copyFileSync("dist/server.js", join(staging, "dist/server.js"));
  copyFileSync("README.md", join(staging, "README.md"));
  const packed = {
    name: metadata.name,
    version: metadata.version,
    type: metadata.type,
    description: metadata.description,
    homepage: metadata.homepage,
    license: metadata.license,
    repository: metadata.repository,
    publishConfig: metadata.publishConfig,
    engines: metadata.engines,
    bin: metadata.bin,
    files: metadata.files,
    dependencies: { "@steamfield/stacks": cli.version },
  };
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(packed, null, 2)}\n`);
  rmSync(destination, { recursive: true, force: true });
  const result = Bun.spawnSync(["bun", "pm", "pack", "--destination", destination], {
    cwd: staging,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`MCP pack failed with exit ${result.exitCode}`);
  const filename = `steamfield-stacks-mcp-${metadata.version}.tgz`;
  const tarball = join(destination, filename);
  const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  writeFileSync(`${tarball}.sha256`, `${digest}  ${filename}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
