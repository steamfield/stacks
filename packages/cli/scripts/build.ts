import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

function dependencyNotices(metafile: Bun.BuildMetafile): string {
  const roots = Object.keys(metafile.inputs).flatMap((input) => {
    const root = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1];
    return root ? [root] : [];
  });
  return [...new Set(roots)]
    .sort()
    .map((root) => {
      const notices = readdirSync(root)
        .filter((file) => /^(?:licen[cs]e|notice|copying)(?:[.-]|$)/i.test(file))
        .sort();
      if (!notices.length) throw new Error(`Bundled dependency has no license notice: ${root}`);
      const name = root.slice(root.lastIndexOf("node_modules/") + "node_modules/".length);
      return `${name}\n\n${notices.map((file) => readFileSync(join(root, file), "utf8")).join("\n\n")}`;
    })
    .join("\n\n");
}

const startedAt = performance.now();
mkdirSync("dist", { recursive: true });
// Remove the retired stacks artifacts when rebuilding an existing checkout.
for (const artifact of ["dist/stacks", "dist/stacks.mjs"]) rmSync(artifact, { force: true });
const result = await Bun.build({
  entrypoints: ["src/bin.ts"],
  outdir: "dist",
  naming: "cli.mjs",
  target: "node",
  format: "esm",
  packages: "bundle",
  define: {
    STACKS_RELEASE_BUILD: "true",
    STACKS_PUBLISHED_TELEMETRY: process.env.STACKS_PUBLISH_TELEMETRY === "1" ? "true" : "false",
    PACKAGED_GITIGNORES: JSON.stringify(
      readdirSync("registry", { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith("/.gitignore"))
        .sort(),
    ),
  },
  minify: true,
  sourcemap: "none",
  metafile: true,
});
if (!result.success) throw new AggregateError(result.logs, "Node bundle build failed");
if (!result.metafile) throw new Error("Node bundle has no dependency manifest");
appendFileSync(
  "dist/cli.mjs",
  `\n/*\nThird-party notices\n\n${dependencyNotices(result.metafile).replaceAll("*/", "* /")}\n*/\n`,
);
copyFileSync("scripts/node-entry.mjs", "dist/stacks");
chmodSync("dist/stacks", 0o755);
console.log(`Built dist/stacks in ${((performance.now() - startedAt) / 1_000).toFixed(2)}s.`);
console.log("Run `./dist/stacks` from packages/cli to demo the build.");
console.log("From the repo root, run `./packages/cli/dist/stacks`.");
