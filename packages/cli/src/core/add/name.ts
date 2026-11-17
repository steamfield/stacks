/**
 * Infers a project name so fragment templates can fill `{{name}}` even on an adopted project or
 * one with an older manifest. Project manifests are read as data (trust point 1).
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { parse } from "smol-toml";
import { slug } from "../text/slug";

const Package = Schema.Struct({ name: Schema.optionalKey(Schema.String) });
const Python = Schema.Struct({
  project: Schema.optionalKey(Package),
  tool: Schema.optionalKey(Schema.Struct({ poetry: Schema.optionalKey(Package) })),
});
const Cargo = Schema.Struct({ package: Schema.optionalKey(Package) });

const SOURCES = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"] as const;

/** Throws on malformed input so `inferName` can warn and try the next source. */
function declaredName(source: (typeof SOURCES)[number], text: string): string | undefined {
  switch (source) {
    case "package.json": {
      const data: unknown = JSON.parse(text);
      // Drop an npm scope: `@acme/web` names the project `web`.
      return Schema.decodeUnknownSync(Package)(data).name?.replace(/^@[^/]+\//, "");
    }
    case "pyproject.toml": {
      const data = Schema.decodeUnknownSync(Python)(parse(text));
      return data.project?.name?.trim() || data.tool?.poetry?.name;
    }
    case "Cargo.toml":
      return Schema.decodeUnknownSync(Cargo)(parse(text)).package?.name;
    case "go.mod": {
      const module = /^\s*module\s+(?:"([^"\n]+)"|([^\s]+))/m.exec(text);
      const parts = (module?.[1] ?? module?.[2] ?? "").split("/");
      // A major-version suffix (`example.com/app/v2`) isn't the name.
      if (/^v\d+$/.test(parts.at(-1) ?? "")) parts.pop();
      return parts.at(-1);
    }
  }
}

/** Fall back to the directory name after trying the declared names in `SOURCES` order. */
export const inferName = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const warnings: Array<{ code: "name_unreadable"; id: string }> = [];
    for (const source of SOURCES) {
      const text = yield* Effect.option(fs.readFileString(path.join(root, source)));
      if (Option.isNone(text)) continue;
      const parsed = yield* Effect.option(Effect.try(() => declaredName(source, text.value)));
      if (Option.isNone(parsed)) warnings.push({ code: "name_unreadable", id: source });
      else if (parsed.value?.trim())
        return { name: { value: slug(parsed.value), source }, warnings };
    }
    return { name: { value: slug(path.basename(root)), source: "directory" }, warnings };
  });
