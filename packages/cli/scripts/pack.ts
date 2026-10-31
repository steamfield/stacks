import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { name, version } from "../package.json";
import { escapedRegistryFiles } from "./packaging";

/** The fixed time npm packers give every member. */
const PACKED_AT = new Date("1985-10-26T08:15:00Z");

const packed = Bun.spawnSync(["bun", "pm", "pack", "--destination", "dist/pack", "--quiet"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
if (packed.exitCode !== 0) process.exit(packed.exitCode);
const filename = `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
const tarball = `dist/pack/${filename}`;
restoreDroppedFiles(tarball);
const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
writeFileSync(`${tarball}.sha256`, `${digest}  ${filename}\n`);

/** Root ownership with no names, in bsdtar's (macOS) or GNU tar's (Linux) spelling. */
function anonymousOwner(): string[] {
  const bsd = execFileSync("tar", ["--version"], { encoding: "utf8" }).includes("bsdtar");
  return bsd
    ? ["--uid", "0", "--gid", "0", "--uname", "", "--gname", ""]
    : ["--owner=0", "--group=0", "--numeric-owner"];
}

/** Packers and installers drop .gitignore and bunfig.toml; bin.ts exposes the escaped assets. */
function restoreDroppedFiles(archive: string) {
  const files = escapedRegistryFiles();
  if (!files.length) return;
  const staging = mkdtempSync(join(tmpdir(), "stacks-pack-"));
  try {
    const tar = join(staging, "package.tar");
    writeFileSync(tar, gunzipSync(readFileSync(archive)));
    const additions = files.map((file) => `package/registry/${file}.stacks`);
    for (const [index, file] of files.entries()) {
      const target = additions[index];
      if (target === undefined) throw new Error("Missing registry archive path");
      if (existsSync(join("registry", `${file}.stacks`)))
        throw new Error("Registry packaging escape collides");
      mkdirSync(dirname(join(staging, target)), { recursive: true });
      copyFileSync(join("registry", file), join(staging, target));
      // npm's fixed member time, so the tarball is reproducible.
      utimesSync(join(staging, target), PACKED_AT, PACKED_AT);
    }
    // Append preserves the packer's manifest, modes and all existing archive members. The added
    // members carry no owner of the machine that packed them.
    execFileSync("tar", ["-rf", tar, ...anonymousOwner(), "-C", staging, ...additions]);
    writeFileSync(archive, gzipSync(readFileSync(tar), { level: 9 }));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
