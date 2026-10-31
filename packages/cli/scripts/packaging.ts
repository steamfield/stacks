import { readdirSync } from "node:fs";

/** File names npm and Bun packers or installers drop from a tarball, so the registry ships them escaped. */
const DROPPED = new Set([".gitignore", "bunfig.toml"]);

/** Registry-relative paths of every asset that ships as `<path>.stacks`. */
export const escapedRegistryFiles = (): string[] =>
  readdirSync("registry", { recursive: true, encoding: "utf8" })
    .filter((file) => DROPPED.has(file.split(/[\\/]/).at(-1) ?? ""))
    .sort();
