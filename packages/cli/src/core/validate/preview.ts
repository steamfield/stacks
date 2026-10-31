import { Effect, Path } from "effect";
import { AppConfig } from "../../config";
import { BadInput, NotFound } from "../../errors";
import type { BriefPreview } from "../../schemas/validate";
import { targetAgents } from "../compose/agents";
import { type ComposeOptions, compose } from "../compose/compose";
import { fingerprint } from "../fingerprint";
import { type Entry, isRejected } from "../registry/entry";
import { Registry } from "../registry/registry";
import { addCompositionChecks } from "./add-compositions";
import { canonicalBrief, composedLimit } from "./budget";
import { composeEachChecks } from "./compose-each";
import { composedFiles } from "./composed";
import { loadChecks } from "./format";
import { gitChecks } from "./git";
import { checks, compareFindings, validationRoots } from "./index";
import { readSources } from "./sources";
import type { Target } from "./target";
import { rootPaths, type View } from "./view";

export type PreviewOptions = {
  stack: string;
  with: ReadonlyArray<string>;
  without: ReadonlyArray<string>;
  preset: "default" | "sandbox";
};

/**
 * The brief `new` would render for a composition, without writing anything: composed through the
 * same roots `validate` uses for `target`, and rendered with the canonical context, so its counts
 * are the ones the budget checks. Compose failures (an unknown id, a conflict) are the command's.
 */
export const previewBrief = (target: Target, options: PreviewOptions) =>
  Effect.gen(function* () {
    const roots = yield* validationRoots(target);
    const settings = yield* (yield* AppConfig).get;
    return yield* Effect.gen(function* () {
      const registry = yield* Registry;
      const all = yield* registry.all;
      if (
        !all.some((entry) => entry.kind === "stack" && entry.id === options.stack) &&
        all.some((entry) => entry.kind === "fragment" && entry.id === options.stack)
      )
        return yield* new BadInput({ details: { id: options.stack, flag: "brief_stack" } });
      const composeOptions: ComposeOptions = {
        ...options,
        agents: targetAgents(undefined, settings).slice(0, 1),
        always: [],
        mode: "new",
      };
      const composition = yield* compose(composeOptions).pipe(
        // `list` doesn't read a root given to validate, so the not-found hint names this root.
        Effect.mapError((error) =>
          error._tag === "NotFound" && error.details && !target.bundled
            ? new NotFound({ details: { ...error.details, root: target.root } })
            : error,
        ),
      );
      const path = yield* Path.Path;
      const selected = [composition.stack, ...composition.fragments];
      const wanted = (item: { kind: string; id: string }) =>
        selected.some((entry) => entry.kind === item.kind && entry.id === item.id);
      // Keep original bodies, including every conditional branch, for the entry checks.
      const entries = all.filter((entry): entry is Entry => !isRejected(entry) && wanted(entry));
      const sourceView: Omit<View, "composed"> = {
        root: target.root,
        bundled: target.bundled,
        entries,
        rejected: [],
        all,
        sources: yield* readSources(entries),
        wanted,
        ...rootPaths(path, target.root),
        composition: { ...composition, options: composeOptions },
      };
      const view: View = {
        ...sourceView,
        composed: yield* Effect.cached(composedFiles(sourceView)),
      };
      // Loading already succeeded. Git checks depend on the checkout and start a process;
      // compose-each checks fragment compatibility across stacks. Both are registry properties,
      // outside this canonical, process-free preview of one composition.
      const findings = (yield* Effect.forEach(
        checks.filter(
          (check) =>
            check !== loadChecks &&
            check !== gitChecks &&
            check !== composeEachChecks &&
            check !== addCompositionChecks,
        ),
        (check) => check(view),
      ))
        .flatMap((result) => result.findings)
        .sort(compareFindings);
      const brief = canonicalBrief(composition);
      return {
        stack: composition.stack.id,
        preset: composition.preset,
        fragments: composition.fragments.map((fragment) => fragment.id),
        app: composition.app?.id ?? null,
        briefWords: brief.briefWords,
        fixedWords: brief.fixedWords,
        limit: composedLimit(composition),
        warnings: composition.warnings.map(({ code, id }) => ({ code, id })),
        brief: brief.text,
        fingerprint: yield* fingerprint(composition),
        findings,
      } satisfies BriefPreview;
    }).pipe(Effect.provide(Registry.layer(roots)));
  });
