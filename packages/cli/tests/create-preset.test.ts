import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import * as T from "../src/core/brief/text";
import { AddResult } from "../src/schemas/add";
import { Settings } from "../src/schemas/config";
import { DoctorReport } from "../src/schemas/doctor";
import { NewResult } from "../src/schemas/new";
import { BriefPreview } from "../src/schemas/validate";
import {
  createCli,
  createFailure,
  createWorkspace,
  jsonResult,
  putCreate,
  releaseCreate,
} from "./helpers/create";
import { minimal, writeEntry } from "./helpers/registry";
import { reviewSearchFixture } from "./helpers/search-fixture";
import { readManifestAt } from "./helpers/verify";

afterEach(releaseCreate);
function setup(settings?: unknown) {
  const home = createWorkspace();
  const registry = createWorkspace();
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "plain",
    frontmatter: minimal(
      "stack",
      "plain",
      'decisions: ["Layout (default: one package)."]\nfragments: { default: [shipping] }\nverify: [{ name: publish, layer: build, tags: [prod], run: make publish }]',
    ),
  });
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "shipping",
    frontmatter: minimal("fragment", "shipping").replace("category: tooling", "category: deploy"),
  });
  if (settings !== undefined)
    putCreate(home, "config/stacks/config.json", JSON.stringify(settings));
  reviewSearchFixture(registry);
  return { home, registry };
}
async function newProject(home: string, registry: string, dir: string, flags: string[] = []) {
  const result = jsonResult(
    await createCli(home, ["new", "plain", dir, "--json", "--author", "", ...flags], {
      host: { registry },
    }),
    NewResult,
  );
  const manifest = Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(result.project, ".stacks/manifest.json"), "utf8")),
  );
  expect(manifest.preset).toBe(result.preset);
  return { result, manifest, brief: readFileSync(join(result.project, result.brief), "utf8") };
}

function presetBehavior(project: Awaited<ReturnType<typeof newProject>>, preset: string) {
  const sandbox = preset === "sandbox";
  expect(project.result.preset).toBe(preset);
  expect(project.result.fragments).toEqual(sandbox ? [] : ["shipping"]);
  expect(project.manifest.fragments.map((fragment) => fragment.id)).toEqual(
    sandbox ? [] : ["shipping"],
  );
  expect(project.manifest.verify.find((step) => step.name === "publish")).toMatchObject({
    skipByDefault: sandbox,
  });
  expect(project.brief).toContain(sandbox ? T.decisions.yes : T.decisions.ask);
  expect(project.brief).not.toContain(sandbox ? T.decisions.ask : T.decisions.yes);
}

test("Settings accepts both presets and keeps excess-property checking [3.1b#5] [3.1b#6]", () => {
  for (const preset of ["default", "sandbox"])
    expect(Schema.decodeUnknownSync(Settings, { onExcessProperty: "error" })({ preset })).toEqual({
      preset,
    });
  expect(() =>
    Schema.decodeUnknownSync(Settings, { onExcessProperty: "error" })({
      preset: "sandbox",
      presett: "default",
    }),
  ).toThrow();
});

test("new uses the setting and records an explicit default override in its result and manifest [3.1b#5]", async () => {
  const { home, registry } = setup({ preset: "sandbox" });
  const configured = await newProject(home, registry, "configured");
  presetBehavior(configured, "sandbox");
  const overridden = await newProject(home, registry, "overridden", ["--preset", "default"]);
  presetBehavior(overridden, "default");
  expect(JSON.parse(readFileSync(join(home, "config/stacks/config.json"), "utf8"))).toEqual({
    preset: "sandbox",
  });
});

test("contradictory sandbox and preset default flags are Usage before writing [3.1b#5]", async () => {
  const { home, registry } = setup({ preset: "sandbox" });
  createFailure(
    await createCli(
      home,
      ["new", "plain", "contradiction", "--sandbox", "--preset", "default", "--json"],
      { host: { registry } },
    ),
    2,
    "Usage",
  );
  expect(existsSync(join(home, "contradiction"))).toBe(false);
});

test("an unknown config key fails new but doctor reports the error successfully [3.1b#6]", async () => {
  const { home, registry } = setup({ presett: "sandbox" });
  createFailure(
    await createCli(home, ["new", "plain", "app", "--json"], { host: { registry } }),
    3,
    "InvalidConfig",
  );
  expect(existsSync(join(home, "app"))).toBe(false);
  const doctor = jsonResult(
    await createCli(home, ["doctor", "--json"], { host: { registry } }),
    DoctorReport,
  );
  expect(doctor.configErrors).toEqual(["Configuration is invalid."]);
});

test.each([
  { settings: undefined, flags: ["--preset", "sandbox"], preset: "sandbox" },
  { settings: { preset: "default" }, flags: ["--sandbox"], preset: "sandbox" },
  {
    settings: { preset: "default" },
    flags: ["--sandbox", "--preset", "sandbox"],
    preset: "sandbox",
  },
  { settings: undefined, flags: [], preset: "default" },
])(
  "preset precedence and compatible aliases: %j [3.1b#19]",
  async ({ settings, flags, preset }) => {
    const { home, registry } = setup(settings);
    presetBehavior(await newProject(home, registry, "app", flags), preset);
  },
);

test.each<{ setting: Manifest["preset"]; flags: string[]; preset: Manifest["preset"] }>([
  { setting: "sandbox", flags: [], preset: "default" },
  { setting: "default", flags: ["--sandbox"], preset: "sandbox" },
])(
  "first add records $preset with setting $setting and flags $flags",
  async ({ setting, flags, preset }) => {
    const { home, registry } = setup({ preset: setting });
    const result = await addDecision(home, registry, home, flags);
    expect(result.createdManifest).toBe(true);
    expectAddPreset(result, preset);
  },
);

test("add keeps a recorded default preset with a sandbox setting", async () => {
  const { home, registry } = setup({ preset: "sandbox" });
  const created = await newProject(home, registry, "app", ["--preset", "default"]);
  expect(created.manifest.preset).toBe("default");
  const result = await addDecision(home, registry, created.result.project);
  expect(result.createdManifest).toBe(false);
  expectAddPreset(result, "default");
});

async function addDecision(home: string, registry: string, project: string, flags: string[] = []) {
  writeEntry({
    root: registry,
    kind: "fragment",
    dir: "decision",
    frontmatter: minimal("fragment", "decision", 'decisions: ["Choose a colour (default blue)."]'),
  });
  return jsonResult(
    await createCli(home, ["add", "decision", "--dir", project, "--json", ...flags], {
      host: { registry },
    }),
    AddResult,
  );
}

function expectAddPreset(result: AddResult, preset: Manifest["preset"]) {
  expect(readManifestAt(result.project).preset).toBe(preset);
  const brief = readFileSync(join(result.project, result.brief), "utf8");
  const sandbox = preset === "sandbox";
  expect(brief).toContain(sandbox ? T.decisions.yes : T.decisions.ask);
  expect(brief).not.toContain(sandbox ? T.decisions.ask : T.decisions.yes);
}

test.each(["Sandbox", "other", null, 1])(
  "an invalid preset setting %j remains a config error [3.1b#20]",
  async (preset) => {
    const { home, registry } = setup({ preset });
    createFailure(
      await createCli(home, ["new", "plain", "app", "--json"], { host: { registry } }),
      3,
      "InvalidConfig",
    );
    expect(existsSync(join(home, "app"))).toBe(false);
    const doctor = jsonResult(
      await createCli(home, ["doctor", "--json"], { host: { registry } }),
      DoctorReport,
    );
    expect(doctor.configErrors).toEqual(["Configuration is invalid."]);
  },
);

test("the preview ignores a configured sandbox preset [3.1b#21]", async () => {
  const { home, registry } = setup({ preset: "sandbox" });
  // A valid registry for preview: cover the D7 layers and declare their project commands.
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "plain",
    frontmatter: minimal(
      "stack",
      "plain",
      "tags: [make]\ncommands: { install: install, lint: lint, typecheck: typecheck, test: test }\nverify:\n  - { name: install, layer: install, run: make install }\n  - { name: lint, layer: lint, run: make lint }\n  - { name: typecheck, layer: typecheck, run: make typecheck }\n  - { name: test, layer: test, run: make test }",
    ),
    body: "## Setup\n\nDescribe setup.\n",
  });
  reviewSearchFixture(registry);
  const preview = jsonResult(
    await createCli(home, ["validate", registry, "--brief", "plain", "--json"], {
      host: { registry },
    }),
    BriefPreview,
  );
  expect(preview.preset).toBe("default");
  expect(preview.findings).toEqual([]);
  expect(existsSync(join(home, "plain"))).toBe(false);
});
