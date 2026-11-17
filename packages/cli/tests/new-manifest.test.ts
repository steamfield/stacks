import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { digestStep, digestSteps, MANIFEST_PATH } from "../src/core/project/manifest";
import { ProjectState } from "../src/core/project/state";
import { NewResult } from "../src/schemas/new";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { gitShim, NOT_A_REPO } from "./helpers/git";
import { minimal, newRegistry, writeEntry } from "./helpers/registry";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function temp() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const asRoot = process.getuid?.() === 0;

/** `new` run in a fresh HOME (also its cwd), with XDG_STATE_HOME at `<home>/state`. */
async function newCli(
  args: string[],
  options: {
    home?: string;
    registry?: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
    /** A terminal and no agent: human output. Without it, the output is an agent's. */
    human?: boolean;
  } = {},
) {
  const home = options.home ?? temp();
  const result = await runCli(["new", ...args], {
    home,
    env: { ...quiet, XDG_STATE_HOME: join(home, "state"), ...options.env },
    host: {
      registry: options.registry ?? newRegistry,
      cwd: home,
      ...(options.human ? terminal : {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return { ...result, home };
}
const decode = (stdout: string) => Schema.decodeUnknownSync(NewResult)(JSON.parse(stdout));
const readManifestFile = (project: string) =>
  Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(project, MANIFEST_PATH), "utf8")),
    {
      onExcessProperty: "error",
    },
  );
const recordsDir = (home: string) => join(home, "state", "stacks", "projects");
const recordFile = (home: string, projectId: string) => join(recordsDir(home), `${projectId}.json`);
const readRecord = (file: string) =>
  Schema.decodeUnknownSync(ProjectState)(JSON.parse(readFileSync(file, "utf8")), {
    onExcessProperty: "error",
  });
const envelope = (stderr: string) =>
  JSON.parse(stderr.trim().split("\n").at(-1) ?? "") as {
    error: { tag: string; message: string; retryable: boolean; details?: unknown };
  };

describe("new writes the manifest and the state record", () => {
  test("new --sandbox --json writes a manifest that decodes, with the result's brief count, and a state record [1.2b#1]", async () => {
    const { status, stdout, stderr, home } = await newCli([
      "fixture-stack",
      "app",
      "--sandbox",
      "--json",
    ]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.stateRecord).toBe(true);
    expect(result.written).toContain(MANIFEST_PATH);
    const manifest = readManifestFile(join(home, "app"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      mode: "new",
      preset: "sandbox",
      agents: ["claude"],
      stack: { id: "fixture-stack", origin: "bundled" },
      briefWords: result.briefWords,
    });
    expect(manifest.fragments.map((ref) => ref.id)).toEqual(result.fragments);
  });

  test("the manifest's digest is digestSteps of it, and the state record holds it with the id and the manifest's real path [1.2b#2]", async () => {
    const { status, home } = await newCli(["fixture-stack", "app", "--json"]);
    expect(status).toBe(0);
    const manifest = readManifestFile(join(home, "app"));
    expect(manifest.verifyDigest).toBe(digestSteps(manifest));
    const file = recordFile(home, manifest.projectId);
    expect(readdirSync(recordsDir(home))).toEqual([`${manifest.projectId}.json`]);
    const record = readRecord(file);
    // On macOS the temporary directory is reached through /var, a link to /private/var.
    const real = realpathSync(join(home, "app", MANIFEST_PATH));
    expect(record).toEqual({
      schemaVersion: 1,
      projectId: manifest.projectId,
      manifestPath: real,
      verifyDigest: manifest.verifyDigest,
      stepDigests: Object.fromEntries(manifest.verify.map((step) => [step.name, digestStep(step)])),
      settingsDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      createdAt: manifest.createdAt,
      firstGreenAt: null,
      firstTestPassAt: null,
    });
    expect(Object.keys(record.stepDigests).sort()).toEqual(
      manifest.verify.map((step) => step.name).sort(),
    );
  });

  test("with XDG_STATE_HOME blocked by a file, new still succeeds with stateRecord false and a manifest [1.2b#5]", async () => {
    const home = temp();
    const notDir = join(home, "a-file");
    writeFileSync(notDir, "");
    const run = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { XDG_STATE_HOME: notDir },
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(decode(run.stdout).stateRecord).toBe(false);
    expect(existsSync(join(home, "app", MANIFEST_PATH))).toBe(true);
    const human = await newCli(["fixture-stack", "human"], {
      home,
      env: { XDG_STATE_HOME: notDir },
      human: true,
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain(
      "State record: not written (the state directory isn't writable), so verify's tamper check will use the manifest only.\n",
    );
    const recorded = await newCli(["fixture-stack", "recorded"], { home });
    expect(recorded.stdout).not.toContain("State record:");
  });

  test.skipIf(asRoot)(
    "with XDG_STATE_HOME unwritable, new leaves the state directory unchanged [1.2b#5]",
    async () => {
      const home = temp();
      const locked = join(home, "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o500);
      try {
        const again = await newCli(["fixture-stack", "app2", "--json"], {
          home,
          env: { XDG_STATE_HOME: locked },
        });
        expect(again.status).toBe(0);
        expect(decode(again.stdout).stateRecord).toBe(false);
        expect(readdirSync(locked)).toEqual([]);
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );

  test("when git init fails and the brief is rewritten, the manifest's brief count follows it", async () => {
    const home = temp();
    const bin = gitShim(home, `${NOT_A_REPO}\n  init) exit 1 ;;`);
    const { status, stdout } = await newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
    });
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.git).toBe("none");
    expect(result.stateRecord).toBe(true);
    const manifest = readManifestFile(join(home, "app"));
    expect(manifest.briefWords).toBe(result.briefWords);
    // The rewrite kept the digest the state record holds.
    expect(readRecord(recordFile(home, manifest.projectId)).verifyDigest).toBe(
      manifest.verifyDigest,
    );
  });

  test("an interrupt while git init runs removes the state record along with the project [1.2b#6]", async () => {
    const home = temp();
    const marker = join(home, "init-started");
    const bin = gitShim(
      home,
      `${NOT_A_REPO}\n  init) /bin/mkdir .git; /usr/bin/touch ${JSON.stringify(marker)}; exec /bin/sleep 30 ;;`,
    );
    const controller = new AbortController();
    const running = newCli(["fixture-stack", "app", "--json"], {
      home,
      env: { PATH: bin },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 5000 });
    expect(existsSync(join(home, "app", MANIFEST_PATH))).toBe(true);
    expect(readdirSync(recordsDir(home))).toHaveLength(1);
    controller.abort();
    const { status, stdout } = await running;
    expect(status).toBe(130);
    expect(stdout).toBe("");
    expect(existsSync(join(home, "app"))).toBe(false);
    expect(readdirSync(recordsDir(home))).toEqual([]);
  }, 15000);

  test("--sandbox marks prod steps skipByDefault in the manifest; without it none is [1.2b#7]", async () => {
    const registry = temp();
    writeEntry({
      root: registry,
      kind: "stack",
      dir: "prod-stack",
      frontmatter: minimal(
        "stack",
        "prod-stack",
        [
          "verify:",
          "  - { name: test, run: 'true' }",
          "  - { name: deploy, run: 'true', tags: [prod] }",
          "  - { name: smoke, run: 'true', tags: [slow] }",
        ].join("\n"),
      ),
    });
    const skipped = async (args: string[]) => {
      const run = await newCli(["prod-stack", "app", "--json", ...args], { registry });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const manifest = readManifestFile(join(run.home, "app"));
      expect(manifest.verify.map((step) => step.name)).toEqual(["test", "deploy", "smoke"]);
      return manifest.verify.filter((step) => step.skipByDefault).map((step) => step.name);
    };
    expect(await skipped(["--sandbox"])).toEqual(["deploy"]);
    expect(await skipped([])).toEqual([]);
  });

  test("a detected agent doesn't change the agents new writes for [1.2b#9]", async () => {
    const { status, stdout, home } = await newCli(["fixture-stack", "app", "--json"], {
      env: { CODEX_THREAD_ID: "thread-1" },
    });
    expect(status).toBe(0);
    const result = decode(stdout);
    expect(result.agents).toEqual(["claude"]);
    expect(result.written).toContain(".claude/settings.json");
    expect(readManifestFile(join(home, "app")).agents).toEqual(["claude"]);
  });
});

describe("a target that already holds a scaffold", () => {
  test("is TargetNotEmpty with scaffold unfinished, then green once the record has firstGreenAt [1.2b#11]", async () => {
    const home = temp();
    expect((await newCli(["fixture-stack", "app"], { home })).status).toBe(0);
    const app = join(home, "app");

    const json = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(json.status).toBe(2);
    expect(json.stdout).toBe("");
    expect(json.stderr.trim().split("\n")).toHaveLength(1);
    expect(envelope(json.stderr)).toEqual({
      error: {
        tag: "TargetNotEmpty",
        message: "The target directory is not empty.",
        retryable: false,
        next: "continue with .stacks/BRIEF.md, or remove the directory to start again.",
        details: {
          path: app,
          entries: [
            ".claude",
            ".githooks",
            ".github",
            ".gitignore",
            ".stacks",
            "README.md",
            "plain.txt",
          ],
          scaffold: "unfinished",
        },
      },
    });
    const human = await newCli(["fixture-stack", "app"], { home, human: true });
    expect(human.status).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toBe(
      [
        "The target directory is not empty.",
        `  Path: ${app}`,
        "  Contains: .claude, .githooks, .github, .gitignore, .stacks, README.md, plain.txt",
        "  Scaffold: unfinished. An earlier `new` wrote this.",
        "  Next: continue with .stacks/BRIEF.md, or remove the directory to start again.",
        "",
      ].join("\n"),
    );

    const manifest = readManifestFile(app);
    const file = recordFile(home, manifest.projectId);
    const record = readRecord(file);
    writeFileSync(
      file,
      JSON.stringify({ ...record, firstGreenAt: "2026-10-26T00:00:00.000Z" }, null, 2),
    );
    const green = await newCli(["fixture-stack", "app", "--json"], { home });
    expect(green.status).toBe(2);
    expect(envelope(green.stderr).error.details).toMatchObject({ scaffold: "green" });
    const greenHuman = await newCli(["fixture-stack", "app"], { home });
    expect(greenHuman.stderr).toContain(
      "  Scaffold: green. This is a finished project.\n  Next: pick another directory for a new project, or extend this one with stacks add.\n",
    );
  });

  test("a manifest with no state record, or one that doesn't decode, is unfinished; no manifest means no scaffold detail", async () => {
    const home = temp();
    expect((await newCli(["fixture-stack", "app", "--json"], { home })).status).toBe(0);
    const app = join(home, "app");
    const manifest = readManifestFile(app);
    const scaffoldOf = async (env: Record<string, string> = {}) => {
      const run = await newCli(["fixture-stack", "app", "--json"], { home, env });
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      const details = envelope(run.stderr).error.details as { scaffold?: string };
      return details.scaffold;
    };
    // Another state directory holds no record for this project.
    expect(await scaffoldOf({ XDG_STATE_HOME: join(home, "elsewhere") })).toBe("unfinished");
    writeFileSync(join(app, MANIFEST_PATH), "{ not json");
    expect(await scaffoldOf()).toBe("unfinished");
    writeFileSync(
      join(app, MANIFEST_PATH),
      JSON.stringify({ ...manifest, schemaVersion: 2, extra: true }),
    );
    expect(await scaffoldOf()).toBe("unfinished");

    const bare = join(home, "bare");
    mkdirSync(join(bare, ".stacks"), { recursive: true });
    const run = await newCli(["fixture-stack", "bare", "--json"], { home });
    expect(run.status).toBe(2);
    expect(envelope(run.stderr).error.details).toEqual({ path: bare, entries: [".stacks"] });
  });
});
