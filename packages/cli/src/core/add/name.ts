/**
 * Guesses a project's name for `stacks add` when its manifest doesn't record one, so fragment
 * templates that use `{{name}}` render sensibly.
 *
 * `add/prepare.ts` calls `inferName` only for a project without a recorded name (one `stacks new`
 * didn't create, or an older manifest). The name comes from `package.json`, `pyproject.toml`,
 * `go.mod` or `Cargo.toml`, in that order, and otherwise from the directory name. These files are
 * parsed as data and never run (Trust model point 1).
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { parse } from "smol-toml";
import { slug } from "../slug";

const Package = Schema.Struct({ name: Schema.optionalKey(Schema.String) });
const Python = Schema.Struct({
  project: Schema.optionalKey(Package),
  tool: Schema.optionalKey(Schema.Struct({ poetry: Schema.optionalKey(Package) })),
});
const Cargo = Schema.Struct({ package: Schema.optionalKey(Package) });

/** Project files a name is read from, in precedence order. */
const SOURCES = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"] as const;

/**
 * The project name one file declares, or `undefined` when it names none. Throws when the file
 * doesn't parse; the caller turns that into a `name_unreadable` warning.
 */
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

/**
 * Infer a template name from project files without running anything, falling back to the
 * directory name. A file that exists but can't be parsed adds a warning and the next one is tried.
 */
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
