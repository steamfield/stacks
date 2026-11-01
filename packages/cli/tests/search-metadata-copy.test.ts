import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { quiet, runCli } from "./helpers/cli";
import { created, createFailure } from "./helpers/create";
import {
  bundled,
  cardPath,
  put,
  searchFindings,
  seed,
  stamp,
  validateSearch,
} from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test("copying a bundled entry preserves its card bytes and refuses a second write [4.5b#19]", async () => {
  const home = space.dir();
  const ref = { kind: "stack", id: "mobile-expo" } as const;
  const root = join(home, "config/stacks");
  const invoke = () =>
    runCli(["create", "stack", ref.id, "--from", "bundled", "--json"], {
      home,
      env: quiet,
      host: { registry: bundled },
    });
  const result = await invoke();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  await created({ ...result, home, args: ["create", "stack", ref.id] });
  expect(readFileSync(cardPath(root, ref), "utf8")).toBe(
    readFileSync(cardPath(bundled, ref), "utf8"),
  );
  expect(searchFindings(await validateSearch(root, { home }))).toEqual([]);
  const entry = join(root, "stacks/mobile-expo/STACK.md");
  const before = readFileSync(entry, "utf8");
  const cardBefore = readFileSync(cardPath(root, ref), "utf8");
  createFailure(await invoke(), 2, "BadInput");
  expect(readFileSync(entry, "utf8")).toBe(before);
  expect(readFileSync(cardPath(root, ref), "utf8")).toBe(cardBefore);
  put(entry, `${before}\nChanged guidance.\n`);
  expect(
    searchFindings(await validateSearch(root, { home })).map(({ check, severity }) => ({
      check,
      severity,
    })),
  ).toEqual([{ check: "search-stale", severity: "warning" }]);
  // Validates the copied root against the whole bundled registry, which outgrew the 5 s default.
}, 30_000);

test("copying an entry without a card leaves the user search directory absent [4.5b#19]", async () => {
  const home = space.dir();
  const registry = join(home, "bundled fixture");
  const ref = { kind: "stack", id: "sample" } as const;
  seed(registry, ref);
  const result = await runCli(["create", "stack", ref.id, "--from", "bundled", "--json"], {
    home,
    env: quiet,
    host: { registry },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  await created({ ...result, home, args: ["create", "stack", ref.id] });
  expect(existsSync(join(home, "config/stacks/search"))).toBe(false);
});

test("an occupied sidecar target preserves both the card and the existing entry [4.5b#19]", async () => {
  const home = space.dir();
  const registry = join(home, "bundled fixture");
  const ref = { kind: "stack", id: "sample" } as const;
  seed(registry, ref);
  await stamp(registry, ref);
  const root = join(home, "config/stacks");
  put(cardPath(root, ref), "existing card bytes");
  const result = await runCli(["create", "stack", ref.id, "--from", "bundled", "--json"], {
    home,
    env: quiet,
    host: { registry },
  });
  createFailure(result, 2, "BadInput");
  expect(readFileSync(cardPath(root, ref), "utf8")).toBe("existing card bytes");
  expect(existsSync(join(root, "stacks/sample"))).toBe(false);
});
