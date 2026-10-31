import {
  DependencyAllowlist,
  type DependencyCards,
  Ecosystem,
  type Ecosystem as EcosystemType,
} from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Schema } from "effect";
import { goAllowlistKey } from "../../src/core/deps";
import { type Entry, isRejected } from "../../src/core/registry/entry";
import { Registry } from "../../src/core/registry/registry";
import { decodeDependencyCards } from "../../src/core/search/sidecar";

export const readAllowlist = Effect.fn("index.readAllowlist")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, "allowlist.json");
  const text = yield* fs
    .readFileString(file)
    .pipe(Effect.mapError(() => new Error(`${file}: allowlist could not be read.`)));
  const allowlist = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DependencyAllowlist))(
    text,
  ).pipe(Effect.mapError(() => new Error(`${file}: invalid DependencyAllowlist.`)));
  const allowed = new Set(Object.values(allowlist.names).flat());
  const goAllowed = new Set(allowlist.names.go);
  const entries = (yield* (yield* Registry).all).filter(
    (entry): entry is Entry => !isRejected(entry),
  );
  for (const entry of entries)
    for (const names of Object.values(entry.meta.deps))
      for (const name of names)
        if (!allowed.has(name) && !goAllowed.has(goAllowlistKey(name)))
          return yield* Effect.fail(
            new Error(
              `${entry.kind}/${entry.id}: dependency ${name} is missing from allowlist.json.`,
            ),
          );
  return allowlist;
});

export const readDependencyCards = Effect.fn("index.readDependencyCards")(function* (
  generatedAt: string,
) {
  const files = yield* (yield* Registry).dependencyCards;
  const cards: { -readonly [K in EcosystemType]: DependencyCards["cards"][K] } = {
    npm: {},
    pypi: {},
    go: {},
    crates: {},
  };
  for (const ecosystem of Ecosystem.literals) {
    const bytes = files.get(ecosystem);
    if (bytes === undefined) continue;
    const file = yield* decodeDependencyCards(bytes).pipe(
      Effect.mapError(() => new Error(`deps/${ecosystem}.json: invalid DependencyCardFile.`)),
    );
    cards[ecosystem] = file.cards;
  }
  return { formatVersion: 1, generatedAt, cards } satisfies DependencyCards;
});
