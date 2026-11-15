/**
 * The shape of the user's settings file, `config.json` under the stacks config directory.
 *
 * Settings are personal defaults for composing new projects (fragments to always add, the agents
 * to write adapters for, the author name) plus the telemetry choice and a data directory. Every
 * key is optional. `config.ts` decodes the file lazily, inside the commands that need it, so a
 * broken file never stops `doctor` or `--version` from running.
 */
import { AgentId } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { NewPreset } from "./new";

/** An npm scope, with or without its leading `@`: lowercase and URL-safe, no `/`. */
export const NpmScope = Schema.String.check(
  Schema.isPattern(/^@?[a-z0-9-~][a-z0-9-._~]*$/, { expected: "an npm scope such as @acme" }),
);

/**
 * `config.json`. Keys are camelCase except `package_scope`, which is snake_case because authors
 * set it beside the entry frontmatter that uses it. Unknown keys are rejected where it's decoded.
 */
export const Settings = Schema.Struct({
  telemetry: Schema.optional(Schema.Boolean),
  dataDir: Schema.optional(Schema.String),
  /** Fragment ids composed into every stack they apply to. */
  always: Schema.optional(Schema.Array(Schema.String)),
  /** Adapter targets when `new --agents` isn't given, and the order agents are tried at launch. */
  agents: Schema.optional(Schema.Array(AgentId)),
  /** The `author` template variable. */
  author: Schema.optional(Schema.String),
  /** Default for `new`, overridden by its preset flags. */
  preset: Schema.optional(NewPreset),
  /** The `package_scope` template variable, when `new --scope` isn't given. */
  packageScope: Schema.optional(NpmScope),
})
  .pipe(Schema.encodeKeys({ packageScope: "package_scope" }))
  .annotate({
    title: "CLI configuration",
    description: "Optional local data directory and composition defaults",
  });
export type Settings = typeof Settings.Type;
