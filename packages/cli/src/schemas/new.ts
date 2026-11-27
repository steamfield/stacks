/** Defines the `new --json` result and the preset choices shared with settings. */
import { AgentId, Harness, Kind } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { BRIEF_PATH } from "../project-layout";
import { NoticeFields } from "./notice";
import { Origin } from "./origin";
import { ResultPart } from "./part";
import { IndexFallbackReason } from "./remote-index";

/** An entry named by kind and id, as `missingTools` lists the entries that need a tool. */
const EntryRef = Schema.Struct({ kind: Kind, id: Schema.String });

/**
 * `new`'s composition presets. `lean` composes like `default` (and records `default` in the
 * manifest) but selects none of the stack's default fragments.
 */
export const NewPreset = Schema.Literals(["default", "sandbox", "lean"]);
export type NewPreset = typeof NewPreset.Type;

/** What `new` wrote or planned and what to do next; `new --json` prints one. */
export const NewResult = Schema.Struct({
  ...NoticeFields,
  /** The project root, absolute. */
  project: Schema.String,
  /** True for a preview: no project files, state record or repository were created. */
  dryRun: Schema.Boolean,
  /** The composition rendered with neutral template values, hashed as sha256. */
  fingerprint: Schema.String,
  stack: Schema.String,
  /** A workspace stack's parts in `parts` order; absent for a stack without parts. */
  parts: Schema.optionalKey(Schema.Array(ResultPart)),
  /** Composition order. */
  fragments: Schema.Array(Schema.String),
  preset: NewPreset,
  /** The stack's payload variant: `example` (its shipped example) or `none` (`--payload none`). */
  payload: Schema.Literals(["example", "none"]),
  agents: Schema.Array(AgentId),
  /**
   * Every file written (or, for a dry run, planned), relative to the project root, sorted; OS
   * litter is never listed.
   */
  written: Schema.Array(Schema.String),
  brief: Schema.Literal(BRIEF_PATH),
  /** `countWords` of the whole brief. */
  briefWords: Schema.Number,
  /** `countWords` of the brief's fixed text. */
  fixedWords: Schema.Number,
  /**
   * Tools not on PATH: who needs them, and the flags that would leave each out (`--without` for
   * a default fragment, dropping `--with` for one you added); empty when no flag can.
   */
  missingTools: Schema.Array(
    Schema.Struct({
      tool: Schema.String,
      owners: Schema.Array(EntryRef),
      drop: Schema.Array(
        Schema.Struct({ id: Schema.String, flag: Schema.Literals(["without", "with"]) }),
      ),
    }),
  ),
  /** Entries stacks doesn't trust; the brief makes the agent ask before using them. */
  untrusted: Schema.Array(
    Schema.Struct({ id: Schema.String, kind: Kind, origin: Origin, dir: Schema.String }),
  ),
  /**
   * Composition warnings; `git_init_failed` (`id: "git"`, with git's exit code); and
   * `git_unusable` (`id: "git"`, with `git rev-parse`'s exit code when it ran): git couldn't say
   * whether a repository encloses the target (a `.git` it can't read, an ownership refusal, a
   * timeout), so `new` used none and initialized nothing. `index_fallback` (`id: "index"`, with
   * `reason` and, when a cached index was used, its `cachedAt`): the configured index couldn't be
   * revalidated, so `new` used the cached index or the bundled registry.
   */
  warnings: Schema.Array(
    Schema.Struct({
      code: Schema.Literals([
        "always_not_applicable",
        "always_unknown",
        "with_not_applicable",
        "without_not_selected",
        "git_init_failed",
        "git_unusable",
        "index_fallback",
      ]),
      id: Schema.String,
      exitCode: Schema.optionalKey(Schema.Number),
      reason: Schema.optionalKey(IndexFallbackReason),
      cachedAt: Schema.optionalKey(Schema.String),
    }),
  ),
  git: Schema.Literals(["fresh", "parent", "none"]),
  /**
   * Whether the out-of-project state record was written; false when the state directory isn't
   * writable (verify's tamper check is then manifest-only), or for a dry run.
   */
  stateRecord: Schema.Boolean,
  /**
   * What happens next. `inside-agent`: stacks runs inside an agent (`agent`), which should
   * act on `prompt` now, unless `untrusted` (entry ids) is non-empty: then it stops and asks the
   * user first. `print`: no agent was launched, for `reason`; give `prompt` to an agent in the
   * project. `--json` never launches one.
   */
  handoff: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("inside-agent"),
      agent: Schema.Union([AgentId, Schema.Literal("other")]),
      untrusted: Schema.Array(Schema.String),
      prompt: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("print"),
      reason: Schema.Literals([
        "json",
        "no-launch",
        "not-a-terminal",
        "untrusted",
        "no-agent-found",
        "agent-not-found",
        "not-chosen",
      ]),
      /** The `--launch` agent that wasn't on PATH. */
      agent: Schema.optionalKey(Harness),
      untrusted: Schema.Array(Schema.String),
      prompt: Schema.String,
    }),
  ]),
}).annotate({
  title: "New result",
  description: "A project stacks wrote or planned, with its brief and the next step",
});
export type NewResult = typeof NewResult.Type;
