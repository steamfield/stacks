/**
 * Checks the dependency allowlist and the dependency cards when `stacks validate` runs on the
 * bundled registry.
 *
 * The allowlist (`allowlist.json` at the registry root) is the reviewed list of package names,
 * per ecosystem (`npm`, `pypi`, `go`, `crates`), that entries may declare in their `deps`
 * frontmatter. A dependency card (`deps/<ecosystem>.json`) is a short plain-language note about one
 * allowlisted package, which `stacks show` prints beside an entry. Both are maintainer files kept
 * in the bundled registry, so the whole check group is skipped on a root without `allowlist.json`.
 *
 * `core/validate/index.ts` runs `dependencyChecks`. It reports a name allowlisted in two
 * ecosystems, a card for a name not on the allowlist, card copy that is too long, names a version
 * (the same rule as search cards, `search.ts::versionedPlain`) or is unreviewed or overdue for
 * review, and an entry dependency that is allowlisted but has no card. Go modules are matched
 * without their major-version suffix (`core/deps.ts::goAllowlistKey`).
 *
 * Start at `dependencyChecks`.
 */
import {
  DependencyAllowlist,
  type DependencyCard,
  DependencyCardFile,
  Ecosystem,
  type Ecosystem as EcosystemType,
} from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Path, Result, Schema } from "effect";
import type { Finding } from "../../schemas/validate";
import { countWords } from "../brief/words";
import { goAllowlistKey } from "../deps";
import { readSearchFile } from "../search/sidecar";
import { versionedPlain } from "./search";
import type { Check, View } from "./types";
import { finding } from "./view";

/** A reviewed card is due for another review once its review date is this old. */
const REVIEW_INTERVAL_MS = 365 * 86_400_000;

/** Which ecosystems allowlist each name, in `Ecosystem.literals` order. */
type Owners = ReadonlyMap<string, ReadonlyArray<EcosystemType>>;

/** The allowlist file as read from the root: not there, unusable, or decoded. */
type AllowlistRead =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "read"; allowlist: DependencyAllowlist };

/** Decodes a JSON file strictly: an unknown key is a decode failure, not ignored. */
const decode = <S extends Schema.Codec<unknown, unknown>>(schema: S, bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(new TextDecoder().decode(bytes), {
    onExcessProperty: "error",
  });

/** A finding about a registry-level file rather than one entry. */
const issue = (
  check: string,
  severity: Finding["severity"],
  file: string,
  message: string,
): Finding => ({ check, severity, file, message });

const readAllowlist = Effect.fn("validate.dependencyAllowlist")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = path.join(root, "allowlist.json");
  const exists = yield* fs.exists(at).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return { state: "absent" } satisfies AllowlistRead;
  const loaded = yield* Effect.result(fs.readFile(at));
  if (Result.isFailure(loaded)) return { state: "invalid" } satisfies AllowlistRead;
  const decoded = yield* Effect.result(decode(DependencyAllowlist, loaded.success));
  if (Result.isFailure(decoded)) return { state: "invalid" } satisfies AllowlistRead;
  return { state: "read", allowlist: decoded.success } satisfies AllowlistRead;
});

/** Maps each allowlisted name to its ecosystems, with an error for each name listed twice. */
function allowlistFindings(names: DependencyAllowlist["names"]) {
  const owners = new Map<string, EcosystemType[]>();
  for (const ecosystem of Ecosystem.literals)
    for (const name of names[ecosystem] ?? [])
      owners.set(name, [...(owners.get(name) ?? []), ecosystem]);
  const findings = [...owners]
    .filter(([, ecosystems]) => ecosystems.length > 1)
    .map(([name, ecosystems]) =>
      issue(
        "deps-ambiguous",
        "error",
        "allowlist.json",
        `${name} appears in ${ecosystems.join(" and ")}.`,
      ),
    );
  return { owners, findings };
}

/** Whether a card's copy breaks a word limit. */
function tooLong(card: DependencyCard): boolean {
  return (
    countWords(card.whatItIs) > 30 ||
    (card.example !== undefined && countWords(card.example) > 40) ||
    [...(card.goodAt ?? []), ...(card.notGoodAt ?? [])].some((text) => countWords(text) > 15)
  );
}

/** All of a card's reader-facing copy, for the version check. */
function cardProse(card: DependencyCard): string {
  return [
    card.whatItIs,
    ...(card.goodAt ?? []),
    ...(card.notGoodAt ?? []),
    ...(card.example ? [card.example] : []),
  ].join(" ");
}

/** The copy and review findings for one card; `now` is the current time in milliseconds. */
function cardFindings(
  ecosystem: EcosystemType,
  name: string,
  card: DependencyCard,
  now: number,
): Finding[] {
  const file = `deps/${ecosystem}.json`;
  const label = `${ecosystem}/${name}`;
  const findings: Finding[] = [];
  if (tooLong(card))
    findings.push(issue("search-size", "warning", file, `${label}: copy is too long.`));
  if (versionedPlain(cardProse(card)))
    findings.push(issue("plain-versioned", "warning", file, `${label} names a version.`));
  if (card.source.reviewedAt === null)
    findings.push(issue("deps-unreviewed", "warning", file, `${label} needs review.`));
  else if (now - Date.parse(`${card.source.reviewedAt}T00:00:00Z`) > REVIEW_INTERVAL_MS)
    findings.push(issue("deps-review-due", "note", file, `${label} review is over 365 days old.`));
  return findings;
}

/**
 * Checks one ecosystem's card file. `present` lists the `<ecosystem>/<name>` keys that have an
 * allowlisted card, for the missing-card check; a card for a name off the allowlist is an error
 * and doesn't count as present.
 */
const inspectFile = Effect.fn("validate.dependencyFile")(function* (
  view: View,
  ecosystem: EcosystemType,
  allowed: ReadonlyArray<string>,
  now: number,
) {
  const file = `deps/${ecosystem}.json`;
  const failed = (message: string) => ({
    present: [],
    findings: [issue("deps-invalid", "error", file, message)],
  });
  const loaded = yield* Effect.result(readSearchFile(view.root, file));
  if (Result.isFailure(loaded)) return failed("Cannot read dependency cards.");
  if (loaded.success === undefined) return { present: [], findings: [] };
  const decoded = yield* Effect.result(decode(DependencyCardFile, loaded.success));
  if (Result.isFailure(decoded)) return failed("Cannot decode dependency cards.");
  const present: string[] = [];
  const findings: Finding[] = [];
  for (const [name, card] of Object.entries(decoded.success.cards)) {
    if (!allowed.includes(name)) {
      findings.push(
        issue("deps-invalid", "error", file, `${ecosystem}/${name} is not on the allowlist.`),
      );
      continue;
    }
    present.push(`${ecosystem}/${name}`);
    findings.push(...cardFindings(ecosystem, name, card, now));
  }
  return { present, findings };
});

/**
 * The `<ecosystem>/<name>` card key for an entry dependency, or undefined when the allowlist
 * doesn't know it. A name listed as is wins; otherwise a Go module matches without its
 * `/vN` major-version suffix.
 */
function cardKey(owners: Owners, dependency: string): string | undefined {
  const goKey = goAllowlistKey(dependency);
  const ecosystem =
    owners.get(dependency)?.[0] ?? (owners.get(goKey)?.includes("go") ? "go" : undefined);
  if (ecosystem === undefined) return undefined;
  return `${ecosystem}/${ecosystem === "go" ? goKey : dependency}`;
}

/** A warning on each validated entry for every allowlisted dependency that has no card. */
function missingFindings(view: View, owners: Owners, present: ReadonlySet<string>) {
  const findings: Finding[] = [];
  for (const entry of view.entries)
    for (const dependency of Object.values(entry.meta.deps).flat()) {
      const key = cardKey(owners, dependency);
      if (key === undefined || present.has(key)) continue;
      findings.push(
        finding(entry, {
          check: "deps-missing",
          severity: "warning",
          file: view.file(entry),
          message: `${key} has no dependency card.`,
        }),
      );
    }
  return findings;
}

export const dependencyChecks: Check = Effect.fn("validate.dependencies")(function* (view) {
  const read = yield* readAllowlist(view.root);
  if (read.state === "absent") return { findings: [] };
  if (read.state === "invalid")
    return {
      findings: [
        issue("deps-invalid", "error", "allowlist.json", "Cannot decode dependency allowlist."),
      ],
    };
  const { names } = read.allowlist;
  const { owners, findings } = allowlistFindings(names);
  const present = new Set<string>();
  const now = yield* Clock.currentTimeMillis;
  for (const ecosystem of Ecosystem.literals) {
    const checked = yield* inspectFile(view, ecosystem, names[ecosystem] ?? [], now);
    for (const key of checked.present) present.add(key);
    findings.push(...checked.findings);
  }
  findings.push(...missingFindings(view, owners, present));
  return { findings };
});
