import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { JsonSchema, Schema, SchemaRepresentation } from "effect";
import { expect, test } from "vitest";
import { bundled, samples } from "./helpers/native-adapters";

const recordedSchema = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
  JSON.parse(readFileSync(join(samples, "claude-plugin.schema.json"), "utf8")),
);
const marketplaceSchema = Schema.toType(
  SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(recordedSchema), {
    patterns: "apply",
  }),
);
const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  skills: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
});
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function skillFiles(directory: string) {
  const direct = join(directory, "SKILL.md");
  if (existsSync(direct)) return [direct];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(directory, entry.name, "SKILL.md"))
    .filter(existsSync);
}

test("the recorded marketplace schema accepts skills directories and rejects malformed metadata [3.4b#4]", () => {
  const decode = Schema.decodeUnknownSync(marketplaceSchema);
  expect(() => decode({ name: "stacks", skills: ["./skills/stacks"] })).not.toThrow();
  expect(() => decode({ name: "Bad Name", skills: ["skill"] })).toThrow();
  expect(() => decode({ name: "stacks", skills: 1 })).toThrow();
});

test("the Claude marketplace manifest decodes and names a contained shipped copy of the CLI skill [3.4b#4]", () => {
  const cli = join(bundled, "..");
  const root = realpathSync(join(cli, "plugin"));
  const json: unknown = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
  Schema.decodeUnknownSync(marketplaceSchema)(json);
  const manifest = Schema.decodeUnknownSync(Manifest)(json);
  const pkg = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
    JSON.parse(readFileSync(join(cli, "package.json"), "utf8")),
  );
  expect(manifest.name).toBe("stacks");
  expect(manifest.version).toBe(pkg.version);
  // Claude Code always scans the default skills/ directory; a `skills` field only adds to it.
  const extra = manifest.skills ?? [];
  const paths = ["./skills", ...(typeof extra === "string" ? [extra] : extra)];
  const discovered: string[] = [];
  for (const path of paths) {
    expect(path.split(/[\\/]/)).not.toContain("..");
    const files = skillFiles(join(root, path));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const skill = realpathSync(file);
      const inside = relative(root, skill);
      expect(inside.startsWith(`..${sep}`) || inside === "..").toBe(false);
      discovered.push(skill);
    }
  }
  for (const name of ["stacks", "stacks-author"])
    expect(discovered).toContain(realpathSync(join(root, "skills", name, "SKILL.md")));
});

/** Every file under `dir`, relative and sorted. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

test("the plugin carries a byte-identical copy of every file of both shipped skills", () => {
  const cli = join(bundled, "..");
  const shipped = join(cli, "skills");
  const copy = join(cli, "plugin", "skills");
  for (const name of ["stacks", "stacks-author"]) {
    const files = tree(join(shipped, name));
    expect(files, name).toContain("SKILL.md");
    expect(tree(join(copy, name)), name).toEqual(files);
    for (const file of files)
      expect(digest(join(copy, name, file)), `${name}/${file}`).toBe(
        digest(join(shipped, name, file)),
      );
  }
  expect(readdirSync(copy).sort()).toEqual(readdirSync(shipped).sort());
});

const PluginSource = Schema.Struct({
  source: Schema.Literal("git-subdir"),
  url: Schema.Literal("steamfield/stacks"),
  path: Schema.Literal("packages/cli/plugin"),
  ref: Schema.String,
});
const Marketplace = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  owner: Schema.Struct({ name: Schema.String, url: Schema.optionalKey(Schema.String) }),
  plugins: Schema.Tuple([
    Schema.Struct({ name: Schema.String, description: Schema.String, source: PluginSource }),
  ]),
});

test("the marketplace lists the plugin by its manifest name, pinned to the tag of the current release", () => {
  const cli = join(bundled, "..");
  const marketplace = Schema.decodeUnknownSync(Marketplace, { onExcessProperty: "error" })(
    JSON.parse(readFileSync(join(cli, "../../.claude-plugin/marketplace.json"), "utf8")),
  );
  const manifest = Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(cli, "plugin/.claude-plugin/plugin.json"), "utf8")),
  );
  const pkg = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
    JSON.parse(readFileSync(join(cli, "package.json"), "utf8")),
  );
  const [plugin] = marketplace.plugins;
  expect(plugin.name).toBe(manifest.name);
  expect(marketplace.name).toBe(manifest.name);
  // scripts/release.ts refuses to tag a release whose marketplace pins another ref.
  expect(plugin.source.ref).toBe(`v${pkg.version}`);
  expect(existsSync(join(cli, "plugin/.claude-plugin/plugin.json"))).toBe(true);
});
