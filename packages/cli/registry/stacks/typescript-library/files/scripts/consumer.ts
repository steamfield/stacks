#!/usr/bin/env bun
// `bun run test:consumer`: proves the package the way npm would ship it. Packs it (prepack builds
// dist/ first), installs the tarball into a temporary copy of tests/consumer/, then typechecks the
// fixture against the installed declarations and runs it with Node. Tests that import src/ can't
// catch a wrong "exports" map, a missing file or declarations that don't match the build.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string };

function run(command: string, args: string[], cwd: string): void {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

const work = mkdtempSync(join(tmpdir(), "consumer-"));
try {
  run("bun", ["pm", "pack", "--destination", work, "--quiet"], root);
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error(`bun pm pack wrote no tarball into ${work}`);

  const app = join(work, "app");
  cpSync(join(root, "tests/consumer"), app, { recursive: true });
  const manifest = {
    name: "consumer",
    private: true,
    type: "module",
    dependencies: { [name]: `file:${join(work, tarball)}` },
  };
  writeFileSync(join(app, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  run("bun", ["install", "--no-save"], app);
  run(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], app);
  run("node", ["index.mjs"], app);
  run("node", ["index.ts"], app);
  console.log(`consumer: ${tarball} installs, typechecks and runs`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
