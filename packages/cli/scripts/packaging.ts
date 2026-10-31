import { readdirSync } from "node:fs";

/** File names npm and Bun packers or installers drop, so the registry ships them escaped. */
const DROPPED = new Set([".gitignore", "bunfig.toml"]);

/** Registry-relative paths of every asset that ships as `<path>.stacks`. */
export const escapedRegistryFiles = (): string[] => {
  const files = readdirSync("registry", { recursive: true, encoding: "utf8" });
  const name = (file: string) => file.split(/[\\/]/).at(-1) ?? "";
  // An authored `<dropped name>.stacks` would collide with the escape bin.ts reads back.
  const collision = files.find(
    (file) => DROPPED.has(name(file).replace(/\.stacks$/, "")) && name(file).endsWith(".stacks"),
  );
  if (collision) throw new Error(`Registry file collides with the packaging escape: ${collision}`);
  return files.filter((file) => DROPPED.has(name(file))).sort();
};
