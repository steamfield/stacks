import { Clock, Effect, Option, Schema } from "effect";
import { BadInput, InvalidConfig } from "../../errors";
import { NpmScope, type Settings } from "../../schemas/config";
import { envPrefix, slug } from "../slug";
import { authorValue, type TemplateValues } from "../template";
import { hasControl } from "../text";
import { gitUserName } from "./git";

/** Check explicit values before composition or target inspection, preserving new's error order. */
export const templateOverrides = (input: {
  scope?: string | undefined;
  author?: string | undefined;
  name?: string | undefined;
}) =>
  Effect.gen(function* () {
    if (
      input.scope !== undefined &&
      Option.isNone(Schema.decodeUnknownOption(NpmScope)(input.scope))
    )
      return yield* new BadInput({ details: { id: input.scope, flag: "scope" } });
    if (input.name !== undefined && (hasControl(input.name) || /["\\]/.test(input.name)))
      return yield* new BadInput({ details: { id: input.name, flag: "name" } });
    const author = input.author === undefined ? undefined : authorValue(input.author);
    if (input.author !== undefined && author === undefined)
      return yield* new BadInput({ details: { id: input.author, flag: "author" } });
    return { author, scope: input.scope };
  });

type Overrides = { author: string | undefined; scope: string | undefined };

/** One author precedence and one complete fixed-variable set for every project writer. */
export const templateValues = (input: {
  name: string;
  settings: Settings;
  git: { cwd: string; installed: boolean };
  overrides?: Overrides;
}) =>
  Effect.gen(function* () {
    let author: string | undefined;
    if (input.overrides?.author !== undefined) author = input.overrides.author;
    else if (input.settings.author !== undefined) author = authorValue(input.settings.author);
    else if (input.git.installed) author = authorValue(yield* gitUserName(input.git.cwd)) ?? "";
    else author = "";
    if (author === undefined) return yield* new InvalidConfig();
    const projectSlug = slug(input.name);
    return {
      project_name: input.name,
      project_slug: projectSlug,
      env_prefix: envPrefix(projectSlug),
      package_scope: (input.overrides?.scope ?? input.settings.packageScope ?? "").replace(
        /^@/,
        "",
      ),
      author,
      year: String(new Date(yield* Clock.currentTimeMillis).getUTCFullYear()),
    } satisfies TemplateValues;
  });
