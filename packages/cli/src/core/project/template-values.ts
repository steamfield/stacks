/**
 * Owns template values and validates explicit overrides early so invalid flags fail before slow
 * work.
 */
import { Clock, Effect, Option, Schema } from "effect";
import { BadInput, InvalidConfig } from "../../errors";
import { NpmScope, type Settings } from "../../schemas/config";
import { authorValue, type TemplateValues } from "../template";
import { envPrefix, slug } from "../text/slug";
import { hasControl } from "../text/text";
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

/**
 * The author: an explicit `--author`, else the `author` setting, else git's `user.name`, else
 * empty. An unusable setting is `InvalidConfig`; an unusable git name is empty.
 */
const authorFor = (input: {
  settings: Settings;
  git: { cwd: string; installed: boolean };
  overrides?: Overrides;
}) =>
  Effect.gen(function* () {
    if (input.overrides?.author !== undefined) return input.overrides.author;
    if (input.settings.author !== undefined) {
      const author = authorValue(input.settings.author);
      if (author === undefined) return yield* new InvalidConfig();
      return author;
    }
    if (!input.git.installed) return "";
    return authorValue(yield* gitUserName(input.git.cwd)) ?? "";
  });

/** Share one author precedence and variable set so project writers render templates consistently. */
export const templateValues = (input: {
  name: string;
  settings: Settings;
  git: { cwd: string; installed: boolean };
  overrides?: Overrides;
}) =>
  Effect.gen(function* () {
    const author = yield* authorFor(input);
    const projectSlug = slug(input.name);
    const scope = input.overrides?.scope ?? input.settings.packageScope ?? "";
    return {
      project_name: input.name,
      project_slug: projectSlug,
      env_prefix: envPrefix(projectSlug),
      package_scope: scope.replace(/^@/, ""),
      author,
      year: String(new Date(yield* Clock.currentTimeMillis).getUTCFullYear()),
    } satisfies TemplateValues;
  });
