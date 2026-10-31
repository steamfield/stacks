import {
  DependencyAllowlist,
  type DependencyCard,
  DependencyCardFile,
  Ecosystem,
  type Ecosystem as EcosystemType,
} from "@steamfield/stacks-format";
import { Clock, Effect, FileSystem, Path, Schema } from "effect";
import type { Finding } from "../../schemas/validate";
import { countWords } from "../brief/words";
import { goAllowlistKey } from "../deps";
import { readSearchFile } from "../search/sidecar";
import { versionedPlain } from "./search";
import { type Check, finding, type View } from "./view";

const decode = <S extends Schema.Codec<unknown, unknown>>(schema: S, bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(new TextDecoder().decode(bytes), {
    onExcessProperty: "error",
  });

const issue = (
  check: string,
  severity: Finding["severity"],
  file: string,
  message: string,
): Finding => ({ check, severity, file, message });

function allowlistFindings(names: DependencyAllowlist["names"]) {
  const owners = new Map<string, EcosystemType[]>();
  for (const ecosystem of Ecosystem.literals)
    for (const name of names[ecosystem] ?? [])
      owners.set(name, [...(owners.get(name) ?? []), ecosystem]);
  const findings = [...owners].flatMap(([name, ecosystems]) =>
    ecosystems.length > 1
      ? [
          issue(
            "deps-ambiguous",
            "error",
            "allowlist.json",
            `${name} appears in ${ecosystems.join(" and ")}.`,
          ),
        ]
      : [],
  );
  return { owners, findings };
}

function cardFindings(
  ecosystem: EcosystemType,
  name: string,
  card: DependencyCard,
  now: number,
): Finding[] {
  const file = `deps/${ecosystem}.json`;
  const label = `${ecosystem}/${name}`;
  const findings: Finding[] = [];
  const tooLong =
    countWords(card.whatItIs) > 30 ||
    (card.example !== undefined && countWords(card.example) > 40) ||
    [...(card.goodAt ?? []), ...(card.notGoodAt ?? [])].some((text) => countWords(text) > 15);
  if (tooLong) findings.push(issue("search-size", "warning", file, `${label}: copy is too long.`));
  const prose = [
    card.whatItIs,
    ...(card.goodAt ?? []),
    ...(card.notGoodAt ?? []),
    ...(card.example ? [card.example] : []),
  ].join(" ");
  if (versionedPlain(prose))
    findings.push(issue("plain-versioned", "warning", file, `${label} names a version.`));
  if (card.source.reviewedAt === null)
    findings.push(issue("deps-unreviewed", "warning", file, `${label} needs review.`));
  else if (now - Date.parse(`${card.source.reviewedAt}T00:00:00Z`) > 365 * 86_400_000)
    findings.push(issue("deps-review-due", "note", file, `${label} review is over 365 days old.`));
  return findings;
}

const inspectFile = Effect.fn("validate.dependencyFile")(function* (
  view: View,
  ecosystem: EcosystemType,
  allowed: ReadonlyArray<string>,
  now: number,
) {
  const file = `deps/${ecosystem}.json`;
  const loaded = yield* Effect.result(readSearchFile(view.root, file));
  if (loaded._tag === "Failure")
    return {
      present: [],
      findings: [issue("deps-invalid", "error", file, "Cannot read dependency cards.")],
    };
  if (loaded.success === undefined) return { present: [], findings: [] };
  const decoded = yield* Effect.result(decode(DependencyCardFile, loaded.success));
  if (decoded._tag === "Failure")
    return {
      present: [],
      findings: [issue("deps-invalid", "error", file, "Cannot decode dependency cards.")],
    };
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

function missingFindings(
  view: View,
  owners: ReadonlyMap<string, EcosystemType[]>,
  present: ReadonlySet<string>,
) {
  const findings: Finding[] = [];
  for (const entry of view.entries)
    for (const dependency of Object.values(entry.meta.deps).flat()) {
      const goKey = goAllowlistKey(dependency);
      const ecosystem =
        owners.get(dependency)?.[0] ?? (owners.get(goKey)?.includes("go") ? "go" : undefined);
      const name = ecosystem === "go" ? goKey : dependency;
      if (ecosystem && !present.has(`${ecosystem}/${name}`))
        findings.push(
          finding(entry, {
            check: "deps-missing",
            severity: "warning",
            file: view.file(entry),
            message: `${ecosystem}/${name} has no dependency card.`,
          }),
        );
    }
  return findings;
}

export const dependencyChecks: Check = Effect.fn("validate.dependencies")(function* (view) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = path.join(view.root, "allowlist.json");
  if (!(yield* fs.exists(at).pipe(Effect.orElseSucceed(() => false)))) return { findings: [] };
  const loaded = yield* Effect.result(fs.readFile(at));
  const decoded =
    loaded._tag === "Success"
      ? yield* Effect.result(decode(DependencyAllowlist, loaded.success))
      : undefined;
  if (!decoded || decoded._tag === "Failure")
    return {
      findings: [
        issue("deps-invalid", "error", "allowlist.json", "Cannot decode dependency allowlist."),
      ],
    };
  const { owners, findings } = allowlistFindings(decoded.success.names);
  const present = new Set<string>();
  const now = yield* Clock.currentTimeMillis;
  for (const ecosystem of Ecosystem.literals) {
    const checked = yield* inspectFile(
      view,
      ecosystem,
      decoded.success.names[ecosystem] ?? [],
      now,
    );
    for (const name of checked.present) present.add(name);
    findings.push(...checked.findings);
  }
  findings.push(...missingFindings(view, owners, present));
  return { findings };
});
