import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { parse } from "smol-toml";
import { slug } from "../slug";

const Package = Schema.Struct({ name: Schema.optionalKey(Schema.String) });
const Python = Schema.Struct({
  project: Schema.optionalKey(Package),
  tool: Schema.optionalKey(Schema.Struct({ poetry: Schema.optionalKey(Package) })),
});
const Cargo = Schema.Struct({ package: Schema.optionalKey(Package) });

/** Infer a template name from data only, in the documented precedence order. */
export const inferName = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const warnings: Array<{ code: "name_unreadable"; id: string }> = [];
    const sources = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"] as const;
    for (const source of sources) {
      const text = yield* Effect.option(fs.readFileString(path.join(root, source)));
      if (Option.isNone(text)) continue;
      const parsed = yield* Effect.option(
        Effect.try(() => {
          switch (source) {
            case "package.json": {
              const data: unknown = JSON.parse(text.value);
              return Schema.decodeUnknownSync(Package)(data).name?.replace(/^@[^/]+\//, "");
            }
            case "pyproject.toml": {
              const data = Schema.decodeUnknownSync(Python)(parse(text.value));
              return data.project?.name?.trim() || data.tool?.poetry?.name;
            }
            case "Cargo.toml":
              return Schema.decodeUnknownSync(Cargo)(parse(text.value)).package?.name;
            case "go.mod": {
              const module = /^\s*module\s+(?:"([^"\n]+)"|([^\s]+))/m.exec(text.value);
              const parts = (module?.[1] ?? module?.[2] ?? "").split("/");
              if (/^v\d+$/.test(parts.at(-1) ?? "")) parts.pop();
              return parts.at(-1);
            }
          }
        }),
      );
      if (Option.isNone(parsed)) warnings.push({ code: "name_unreadable", id: source });
      else if (parsed.value?.trim())
        return { name: { value: slug(parsed.value), source }, warnings };
    }
    return { name: { value: slug(path.basename(root)), source: "directory" }, warnings };
  });
