import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { trustQuestion } from "../src/core/create/text";
import { shellWords } from "../src/core/text/shell";
import { ListResult } from "../src/schemas/list";
import { entryPath, entrySnapshot, userRoot } from "./helpers/create";
import { pickerCli, pickerManifest, pickerNew, pickerWorkspace } from "./helpers/picker";
import { minimal, writeEntry } from "./helpers/registry";
import { choose, numberedRows, terminalScript } from "./helpers/scripted-terminal";

const workspaces: ReturnType<typeof pickerWorkspace>[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.cleanup();
});
function workspace() {
  const w = pickerWorkspace();
  workspaces.push(w);
  return w;
}

function fragment(root: string, id: string, extra = "") {
  return writeEntry({
    root,
    kind: "fragment",
    dir: id,
    frontmatter: minimal("fragment", id, extra),
  });
}

test.each([
  { kind: "stack", supplied: false },
  { kind: "fragment", supplied: false },
  { kind: "stack", supplied: true },
  { kind: "fragment", supplied: true },
] as const)(
  "create $kind (kind supplied: $supplied) picks missing arguments and replays as a skeleton [4.4b#4]",
  async ({ kind, supplied }) => {
    const w = workspace();
    const id = `personal-${kind}`;
    const terminal = terminalScript([...(supplied ? [] : [choose(kind)]), id]);
    const run = await pickerCli(w, ["create", ...(supplied ? [kind] : [])], { terminal });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(terminal.reads).toBe(supplied ? 1 : 2);
    const echoes = run.stdout.split("\n").filter((line) => line.startsWith("Running: "));
    expect(echoes).toHaveLength(1);
    const words = shellWords((echoes[0] ?? "").slice("Running: ".length));
    expect(words.slice(0, 4)).toEqual(["stacks", "create", kind, id]);
    const target = entryPath(w.home, kind, id);
    const text = readFileSync(join(target, kind === "stack" ? "STACK.md" : "FRAGMENT.md"), "utf8");
    expect(text).toContain(`id: "${id}"`);
    expect(text).toContain(`kind: ${kind}`);
    const before = entrySnapshot(target).map(snapshotDigest);
    rmSync(target, { recursive: true });
    const replayTerminal = terminalScript();
    const replay = await pickerCli(w, words.slice(1), { terminal: replayTerminal });
    expect(replay.status, replay.stderr).toBe(0);
    expect(replay.stderr).toBe("");
    expect(replay.stdout).toContain(`Created ${kind} ${id}`);
    expect(replayTerminal.reads).toBe(0);
    expect(entrySnapshot(target).map(snapshotDigest)).toEqual(before);
  },
);

test("add offers exactly list's ordered addable set, then applies the selected row [4.4b#3]", async () => {
  const w = workspace();
  const initial = await pickerNew(w, ["--with", "picker-extra", "--no-launch"]);
  expect(initial.status, initial.stderr).toBe(0);
  expect(initial.stderr).toBe("");
  expect(initial.stdout).toContain("picker-stack");
  fragment(w.registry, "z-global");
  fragment(w.registry, "b-fit", "applies_to: [picker-stack]");
  fragment(w.registry, "a-misfit", "applies_to: [another-stack]");
  writeEntry({
    root: w.registry,
    kind: "fragment",
    dir: "c-app",
    frontmatter: minimal("fragment", "c-app", "applies_to: [picker-stack]").replace(
      "category: tooling",
      "category: app",
    ),
  });
  fragment(join(w.project, ".stacks"), "d-project");
  writeEntry({
    root: w.registry,
    kind: "stack",
    dir: "other-stack",
    frontmatter: minimal("stack", "other-stack"),
  });
  const listed = await pickerCli(w, ["list", "--dir", w.project, "--json"]);
  expect(listed.status, listed.stderr).toBe(0);
  expect(listed.stderr).toBe("");
  const catalog = Schema.decodeUnknownSync(ListResult)(JSON.parse(listed.stdout));
  expect(catalog.rejected).toEqual([]);
  expect(catalog.project?.addable).toEqual(["b-fit", "c-app", "d-project", "z-global"]);
  const backup = join(w.home, "before-add");
  cpSync(w.project, backup, { recursive: true });
  const terminal = terminalScript([choose("b-fit")]);
  const run = await pickerCli(w, ["add", "--dir", w.project, "--no-launch"], { terminal });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(terminal.reads).toBe(1);
  const rows = numberedRows(terminal.screens[0] ?? "");
  expect(rows).toHaveLength(4);
  expect(
    rows.map((row) => catalog.entries.find((entry) => row.text.includes(entry.id))?.id),
  ).toEqual(catalog.project?.addable);
  const echoes = run.stdout.split("\n").filter((line) => line.startsWith("Running: "));
  expect(echoes).toHaveLength(1);
  const words = shellWords((echoes[0] ?? "").slice("Running: ".length));
  expect(words.slice(0, 3)).toEqual(["stacks", "add", "b-fit"]);
  expect(words).toContain("--dir");
  expect(words).toContain(w.project);
  expect(words).toContain("--no-launch");
  expect(pickerManifest(w.project).fragments.map((entry) => entry.id)).toEqual([
    "picker-extra",
    "b-fit",
  ]);
  const files = entrySnapshot(w.project)
    .filter((entry) => entry.path !== ".stacks/manifest.json")
    .map(snapshotDigest);
  const manifest = stableManifest(w.project);
  rmSync(w.project, { recursive: true });
  cpSync(backup, w.project, { recursive: true });
  const replayTerminal = terminalScript();
  const replay = await pickerCli(w, words.slice(1), { terminal: replayTerminal });
  expect(replay.status, replay.stderr).toBe(0);
  expect(replay.stderr).toBe("");
  expect(replay.stdout).toContain("b-fit");
  expect(replayTerminal.reads).toBe(0);
  expect(
    entrySnapshot(w.project)
      .filter((entry) => entry.path !== ".stacks/manifest.json")
      .map(snapshotDigest),
  ).toEqual(files);
  expect(stableManifest(w.project)).toEqual(manifest);
});

test("create copy lists trusted kinds first, marks project entries and copies the chosen entry [4.4b#4]", async () => {
  const w = workspace();
  fragment(userRoot(w.home), "z-user-fragment");
  fragment(join(w.home, ".stacks"), "a-local-fragment");
  writeEntry({
    root: join(w.home, ".stacks"),
    kind: "stack",
    dir: "a-local-stack",
    frontmatter: minimal("stack", "a-local-stack"),
  });
  const terminal = terminalScript([choose("copy"), choose("picker-extra")]);
  const run = await pickerCli(w, ["create"], { terminal });
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(terminal.reads).toBe(2);
  const rows = numberedRows(terminal.screens[1] ?? "");
  const ids = ["picker-stack", "picker-extra", "a-local-stack", "a-local-fragment"];
  const offered = rows.map((row) => ids.find((id) => row.text.includes(id)));
  expect(offered).toHaveLength(ids.length);
  expect([...offered].sort()).toEqual([...ids].sort());
  const trusted = rows.filter((row) => !row.text.includes("a-local-"));
  const project = rows.filter((row) => row.text.includes("a-local-"));
  expect(Math.max(...trusted.map((row) => Number(row.number)))).toBeLessThan(
    Math.min(...project.map((row) => Number(row.number))),
  );
  for (const row of project) expect(row.text).toMatch(/project/i);
  expect(rows.find((row) => row.text.includes("picker-stack"))?.text).toMatch(/stack/i);
  expect(rows.find((row) => row.text.includes("picker-extra"))?.text).toMatch(/fragment/i);
  expect(run.stdout).toContain("Running: stacks create fragment picker-extra --from bundled");
  expect(entrySnapshot(entryPath(w.home, "fragment", "picker-extra"))).toEqual(
    entrySnapshot(join(w.registry, "fragments", "picker-extra")),
  );
});

test.each(["no", "yes"])(
  "a picked project fragment uses the named copy confirmation: %s [4.4b#6]",
  async (answer) => {
    const w = workspace();
    const source = fragment(join(w.home, ".stacks"), "local-extra");
    const target = entryPath(w.home, "fragment", "local-extra");
    const terminal = terminalScript([choose("copy"), choose("local-extra"), answer]);
    const picked = await pickerCli(w, ["create"], { terminal });
    expect(terminal.reads).toBe(3);
    expect(picked.stderr).toContain(trustQuestion);
    expect(picked.stdout).toContain("local-extra");
    expect(picked.stderr).toContain(
      "local-extra name (local-extra), fragment, origin project, untrusted",
    );
    expect(picked.stderr).toContain("--- guidance ---");
    expect(picked.stderr.indexOf("local-extra")).toBeLessThan(picked.stderr.indexOf(trustQuestion));
    const question = picked.stderr.slice(picked.stderr.indexOf(trustQuestion));
    const copied = answer === "yes" ? entrySnapshot(target) : [];
    if (answer === "yes") {
      expect(copied).toEqual(entrySnapshot(source));
      // Give the explicit command the same absent target as the picker had.
      rmSync(target, { recursive: true });
    } else expect(existsSync(target)).toBe(false);
    const namedTerminal = terminalScript([answer]);
    const named = await pickerCli(w, ["create", "fragment", "local-extra", "--from", "project"], {
      terminal: namedTerminal,
    });
    expect(picked.status).toBe(answer === "yes" ? 0 : 2);
    expect(picked.status).toBe(named.status);
    expect(picked.stderr).toBe(named.stderr);
    expect(namedTerminal.reads).toBe(1);
    expect(question).toBe(named.stderr.slice(named.stderr.indexOf(trustQuestion)));
    if (answer === "yes") {
      expect(named.stdout).toContain("Created fragment local-extra");
      expect(entrySnapshot(target)).toEqual(copied);
    } else {
      expect(named.stdout).toBe("");
      expect(picked.stderr).toContain("Invalid input.");
      expect(existsSync(target)).toBe(false);
    }
  },
);

test.each([
  { name: "kind", steps: [] },
  { name: "id", steps: [choose("fragment")] },
  { name: "copy source", steps: [choose("copy")] },
])(
  "interrupting create's $name prompt leaves the user registry unchanged [4.4b#5]",
  async ({ steps }) => {
    const w = workspace();
    mkdirSync(userRoot(w.home), { recursive: true });
    writeFileSync(join(userRoot(w.home), "keep.txt"), "personal entry\n");
    const before = entrySnapshot(userRoot(w.home));
    const terminal = terminalScript([...steps, Effect.never]);
    const controller = new AbortController();
    let settled = false;
    const pending = pickerCli(w, ["create"], { terminal, signal: controller.signal }).finally(
      () => {
        settled = true;
      },
    );
    try {
      await vi.waitFor(() => expect(settled || terminal.reads === steps.length + 1).toBe(true));
      expect(terminal.reads).toBe(steps.length + 1);
      expect(settled).toBe(false);
    } finally {
      controller.abort();
      await pending;
    }
    const run = await pending;
    expect(run.status).toBe(130);
    expect(run.stdout).not.toContain("Running:");
    expect(run.stderr).toContain("Command interrupted.");
    expect(entrySnapshot(userRoot(w.home))).toEqual(before);
  },
);

test("interrupting add's choice keeps the existing project byte for byte [4.4b#5]", async () => {
  const w = workspace();
  const initial = await pickerNew(w, ["--no-launch"]);
  expect(initial.status, initial.stderr).toBe(0);
  expect(initial.stderr).toBe("");
  expect(initial.stdout).toContain("picker-stack");
  const before = entrySnapshot(w.project).map(snapshotDigest);
  const terminal = terminalScript([Effect.never]);
  const controller = new AbortController();
  let settled = false;
  const pending = pickerCli(w, ["add", "--dir", w.project, "--no-launch"], {
    terminal,
    signal: controller.signal,
  }).finally(() => {
    settled = true;
  });
  try {
    await vi.waitFor(() => expect(settled || terminal.reads === 1).toBe(true));
    expect(terminal.reads).toBe(1);
    expect(settled).toBe(false);
  } finally {
    controller.abort();
    await pending;
  }
  const run = await pending;
  expect(run.status).toBe(130);
  expect(run.stdout).not.toContain("Running:");
  expect(run.stderr).toContain("Command interrupted.");
  expect(entrySnapshot(w.project).map(snapshotDigest)).toEqual(before);
});

function snapshotDigest(entry: ReturnType<typeof entrySnapshot>[number]) {
  const { bytes, ...fields } = entry;
  return { ...fields, hash: bytes && createHash("sha256").update(bytes).digest("hex") };
}

function stableManifest(project: string) {
  const { handoff, ...manifest } = pickerManifest(project);
  return { ...manifest, handoff: handoff && { kind: handoff.kind, agent: handoff.agent } };
}
