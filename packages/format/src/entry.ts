import { Effect, Schema } from "effect";

export const Kind = Schema.Literals(["stack", "fragment"]);
export type Kind = typeof Kind.Type;

/** A string with at least one non-whitespace character. */
const NonBlank = Schema.String.check(Schema.isPattern(/\S/, { expected: "a non-blank string" }));
export const Kebab = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { expected: "a kebab-case id" }),
);
/** "500ms", "90s", "10m". */
const Duration = Schema.String.check(
  Schema.isPattern(/^\d+(?:ms|s|m)$/, { expected: "a duration such as 500ms, 90s or 10m" }),
);
export const Phase = Schema.Literals(["setup", "check", "serve", "teardown"]);
export type Phase = typeof Phase.Type;
/** `check` is a file or config check (a README with no fill markers, hooks defined). */
export const StepLayer = Schema.Literals([
  "install",
  "lint",
  "typecheck",
  "test",
  "build",
  "serve",
  "docs",
  "check",
]);
export const Category = Schema.Literals([
  "agent-ops",
  "app",
  "ci",
  "deploy",
  "release",
  "service",
  "vendor",
  "tooling",
  "link",
]);
export type Category = typeof Category.Type;

/** A readiness probe for a `serve` step; `${VAR}` in `http` is expanded from the verify env. */
export const Expect = Schema.Struct({
  http: Schema.String,
  within: Schema.optionalKey(Duration),
});
export type Expect = typeof Expect.Type;

/** The tag the CLI adds to an app's steps (1.1); an entry never writes it itself. */
export const APP_TAG = "app";

export const VerifyStep = Schema.Struct({
  name: Kebab,
  run: NonBlank,
  cwd: Schema.optionalKey(Schema.String),
  phase: Schema.optionalKey(Phase),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  expect: Schema.optionalKey(Expect),
  layer: Schema.optionalKey(StepLayer),
  timeout: Schema.optionalKey(Duration),
}).check(
  Schema.makeFilter((step) => {
    const issues: Schema.FilterIssue[] = [];
    if (step.phase === "serve" && !step.expect)
      issues.push({ path: ["expect"], issue: "a serve step needs expect" });
    if (step.tags?.includes(APP_TAG))
      issues.push({ path: ["tags"], issue: `the "${APP_TAG}" tag is reserved for the CLI` });
    return issues;
  }),
);
export type VerifyStep = typeof VerifyStep.Type;

/** A step with every default applied; the one place defaults live (1.2b's digest, 1.3a's runner). */
export type ResolvedStep = Omit<VerifyStep, "phase" | "tags" | "timeout" | "expect"> & {
  phase: NonNullable<VerifyStep["phase"]>;
  tags: ReadonlyArray<string>;
  timeout: string;
  expect?: { http: string; within: string };
};
/** A step's `timeout` when it sets none; the brief shows a step's timeout only when it differs. */
export const DEFAULT_STEP_TIMEOUT = "10m";
export function withStepDefaults(step: VerifyStep): ResolvedStep {
  const { expect, ...rest } = step;
  return {
    ...rest,
    phase: step.phase ?? "check",
    tags: step.tags ?? [],
    timeout: step.timeout ?? DEFAULT_STEP_TIMEOUT,
    ...(expect ? { expect: { http: expect.http, within: expect.within ?? "60s" } } : {}),
  };
}

const list = <S extends Schema.Top>(item: S) =>
  Schema.Array(item).pipe(Schema.withDecodingDefaultKey(Effect.succeed([])));
const strings = Schema.Record(Schema.String, Schema.String).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);
const names = Schema.Record(Schema.String, Schema.Array(Schema.String)).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);

/** Fields both kinds share; lists and records default to empty. */
const shared = {
  schemaVersion: Schema.Literal(1),
  id: Kebab,
  name: NonBlank,
  description: NonBlank,
  tags: list(Schema.String),
  /** Role to package names; names only, never versions (1.5 rejects version-looking values). */
  deps: names,
  commands: strings,
  tools: list(Schema.String),
  decisions: list(Schema.String),
  env: strings,
  verify: list(VerifyStep),
  merge: list(Schema.String),
};

/**
 * A stack a workspace stack mounts in the directory `name`. `role` is any kebab-case string: the
 * roles and their rules belong to the CLI, which refuses one it doesn't know.
 */
export const StackPart = Schema.Struct({
  name: Kebab,
  role: Kebab,
  stack: Kebab,
});
export type StackPart = typeof StackPart.Type;

/**
 * `STACK.md` frontmatter, entry format v1 (D18). YAML keys are snake_case and decode to
 * camelCase fields; excess keys are checked against the snake_case names.
 */
export const StackMeta = Schema.Struct({
  ...shared,
  kind: Schema.Literal("stack"),
  fragments: Schema.Struct({
    required: list(Kebab),
    default: list(Kebab),
    optional: list(Kebab),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  /** Absent, never `[]`, when a stack has none: fingerprints hash the decoded meta. */
  parts: Schema.optionalKey(Schema.NonEmptyArray(StackPart)),
}).pipe(Schema.encodeKeys({ schemaVersion: "schema_version" }));
export type StackMeta = typeof StackMeta.Type;

/** `FRAGMENT.md` frontmatter, entry format v1 (D18). An app is a fragment with `category: app`. */
export const FragmentMeta = Schema.Struct({
  ...shared,
  kind: Schema.Literal("fragment"),
  category: Category,
  appliesTo: list(Schema.String),
  needsOwnRepo: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  requires: list(Kebab),
  conflicts: list(Kebab),
  requiresTools: list(Schema.String),
})
  .check(
    Schema.makeFilter((meta) =>
      meta.category === "app" && meta.appliesTo.length === 0
        ? { path: ["applies_to"], issue: "an app must name at least one stack or tag" }
        : undefined,
    ),
  )
  .pipe(
    Schema.encodeKeys({
      schemaVersion: "schema_version",
      appliesTo: "applies_to",
      needsOwnRepo: "needs_own_repo",
      requiresTools: "requires_tools",
    }),
  );
export type FragmentMeta = typeof FragmentMeta.Type;
