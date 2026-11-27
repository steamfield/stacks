import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join, relative, sep } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Duration, Effect, Exit, Schema } from "effect";
import { afterAll, beforeEach, expect, test } from "vitest";
import { type Entry, isRejected } from "../../src/core/registry/entry";
import { Registry } from "../../src/core/registry/registry";
import { BUDGET } from "../../src/core/validate/compositions/budget";
import { BriefPreview } from "../../src/schemas/validate";
import { Processes } from "../../src/services/processes";
import { runProcesses } from "../helpers/cli";
import { readManifestAt, recordPath } from "../helpers/verify";
import { briefDigests } from "./fixtures/bundled-brief-digests";
import { bundled } from "./helpers/bundled";

import { compositionWorkspace, quote, snapshot } from "./helpers/composition-workspace";

const catalog = await Effect.runPromise(
  Effect.flatMap(Registry, (registry) => registry.all).pipe(
    Effect.provide(Registry.layer([{ origin: "bundled", path: bundled }])),
    Effect.provide(NodeServices.layer),
  ),
);
const entries = catalog.filter((entry): entry is Entry => !isRejected(entry));
const stacks = entries.filter((entry) => entry.meta.kind === "stack");
const fragments = entries.flatMap((entry) =>
  entry.meta.kind === "fragment" ? [{ ...entry, meta: entry.meta }] : [],
);
const releases = fragments.filter((entry) => ["release", "deploy"].includes(entry.meta.category));
const services = fragments.filter((entry) =>
  ["service", "vendor", "tooling"].includes(entry.meta.category),
);
const gate = ["astro-blog", "go-cli", "python-react"];
const presets = ["default", "sandbox"] as const;
const fits = (fragment: (typeof fragments)[number], stack: Entry) =>
  fragment.meta.appliesTo.length === 0 ||
  fragment.meta.appliesTo.includes(stack.id) ||
  stack.meta.tags.some((tag) => fragment.meta.appliesTo.includes(tag));
const sha256 = (text: string | Buffer) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

const { home, cli, scaffold, gitCallsOnly, reset, cleanup } = compositionWorkspace(
  bundled,
  entries.flatMap((entry) => entry.meta.tools),
);
afterAll(cleanup);
beforeEach(reset);

async function writeFragment(fragment: (typeof fragments)[number], scope?: string) {
  const stack = stacks.find((stack) => fits(fragment, stack));
  if (!stack) throw new Error(`no bundled stack applies to ${fragment.id}`);
  const project = join(home, "projects", `${fragment.id} workspace ü`);
  const before = snapshot(home);
  const result = await scaffold(stack.id, project, [
    "--with",
    fragment.id,
    ...(scope === undefined ? [] : ["--scope", scope]),
  ]);
  expect(result.fragments).toContain(fragment.id);
  expect(result.warnings).toEqual([]);
  expect(result.dryRun).toBe(false);
  const manifest = readManifestAt(project);
  expect(manifest.fragments.map((entry) => entry.id)).toEqual(result.fragments);
  for (const step of manifest.verify)
    expect(step.layer, `${fragment.id}: ${step.name}`).toBeDefined();
  const state = relative(home, recordPath(home, manifest.projectId));
  const external = (files: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(files).filter(
        ([path]) =>
          !path.startsWith(`${relative(home, project)}/`) && path !== state && path !== "calls",
      ),
    );
  expect(external(snapshot(home))).toEqual(external(before));
  expect(result.stateRecord).toBe(true);
  expect(existsSync(join(home, state))).toBe(true);
  expect(result.written).toEqual(result.written.toSorted());
  for (const path of result.written) {
    expect(path.startsWith("/") || path.split("/").includes("..")).toBe(false);
    expect(statSync(join(project, path)).isFile()).toBe(true);
    expect(
      relative(realpathSync(project), realpathSync(join(project, path))).split("/"),
    ).not.toContain("..");
  }
  gitCallsOnly();
  return { project, result, manifest };
}

test("the bundled matrix has usable stacks and all five fragment categories [3.3a#1] [3.3c#1]", () => {
  expect(catalog.filter(isRejected)).toEqual([]);
  expect(stacks.map((stack) => stack.id)).toEqual(expect.arrayContaining(gate));
  for (const category of ["release", "deploy", "service", "vendor", "tooling"])
    expect(
      fragments.some((fragment) => fragment.meta.category === category),
      category,
    ).toBe(true);
  for (const fragment of [...releases, ...services])
    expect(
      stacks.some((stack) => fits(fragment, stack)),
      fragment.id,
    ).toBe(true);
});

test.each(stacks)(
  "$id composes every applicable release, deploy, service, vendor and tooling fragment in both presets [3.3a#1] [3.3c#1]",
  async (stack) => {
    for (const fragment of [...releases, ...services].filter((fragment) => fits(fragment, stack))) {
      for (const preset of presets) {
        const result = await scaffold(stack.id, `preview/${stack.id}`, [
          "--with",
          fragment.id,
          "--preset",
          preset,
          "--dry-run",
        ]);
        expect(result).toMatchObject({ dryRun: true, stateRecord: false, preset, warnings: [] });
        expect(result.fragments).toContain(fragment.id);
        expect(existsSync(result.project)).toBe(false);
      }
    }
    gitCallsOnly();
  },
  // Up to two dry runs per applicable fragment; concurrent gates can exceed Vitest's 5 s.
  30_000,
);

test.each(releases.filter((fragment) => fragment.id !== "bun-release"))(
  "$id writes only project files and its state record without running entry commands [3.3a#1]",
  async (fragment) => {
    await writeFragment(fragment);
  },
);
test.each(services)(
  "$id writes safely under a path with spaces and Unicode without running entry commands [3.3c#1]",
  async (fragment) => {
    await writeFragment(fragment);
  },
);

test.each(stacks.filter((stack) => !gate.includes(stack.id)))(
  "$id scaffolds within budget with every D7 layer in both presets [3.3b#1]",
  async (stack) => {
    for (const preset of presets) {
      const result = await scaffold(stack.id, `expanded/${stack.id}-${preset}`, [
        "--preset",
        preset,
      ]);
      expect(result.preset).toBe(preset);
      expect(result.briefWords).toBeLessThanOrEqual(BUDGET.composed);
      const manifest = readManifestAt(result.project);
      const base = manifest.verify.filter(
        (step) => !step.skipByDefault && !step.tags?.includes("app"),
      );
      for (const layer of ["install", "lint", "typecheck", "test"])
        expect(
          base.map((step) => step.layer),
          `${stack.id} ${preset}`,
        ).toContain(layer);
      if (stack.meta.tags.some((tag) => ["web", "api"].includes(tag))) {
        const servers = base.filter((step) => step.phase === "serve");
        expect(servers.length).toBeGreaterThan(0);
        for (const step of servers) {
          expect(step.layer).toBe("serve");
          expect(step.expect?.http).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/);
          expect(step.expect?.within).toMatch(/^\d+(ms|s|m)$/);
        }
      }
      gitCallsOnly();
    }
  },
);

test.each(gate)(
  "%s keeps its canonical briefs byte-identical in both presets [3.3b#3]",
  async (id) => {
    for (const preset of presets) {
      const run = await cli([
        "validate",
        "--brief",
        id,
        "--json",
        ...(preset === "sandbox" ? ["--sandbox"] : []),
      ]);
      expect(run.status).toBe(0);
      expect(run.stderr).toBe("");
      const preview = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(run.stdout));
      expect(preview).toMatchObject({ stack: id, preset, warnings: [] });
      expect(sha256(preview.brief)).toBe(briefDigests[`${id}:${preset}`]);
    }
  },
);

test.each([
  ["astro-blog", "bun-release"],
  ["react-router", "bun-release"],
  ["mobile-expo", "docker-deploy"],
  ["astro-blog", "openrouter-ai"],
])("%s warns when %s does not apply", async (stack, fragment) => {
  const run = await cli(["validate", "--brief", stack, "--with", fragment, "--json"]);
  expect(run.status, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  const preview = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(run.stdout));
  expect(preview.warnings).toEqual([{ code: "with_not_applicable", id: fragment }]);
  expect(preview.findings.filter((finding) => finding.severity === "error")).toEqual([]);
});

// python-react's build is its frontend part's, so the mounted step carries the part prefix.
test.each([
  ["astro-blog", "build"],
  ["python-react", "frontend-build"],
])("%s keeps the build step enabled in sandbox verification", async (stack, name) => {
  const result = await scaffold(stack, `build-${stack}-sandbox`, ["--sandbox"]);
  const build = readManifestAt(result.project).verify.find((step) => step.name === name);
  expect(build).toMatchObject({ skipByDefault: false });
});

test("a shared fragment branch for another stack leaves gate briefs and fingerprints unchanged [3.3b#4]", async () => {
  const registry = join(home, "conditional-registry");
  const payloads = new Set([
    join("stacks", "go-cli"),
    ...["agent-ops", "git-hooks", "ci-github"].map((id) => join("fragments", id)),
  ]);
  // Keep every entry's metadata for conditional/reference checks, and only this composition's files.
  cpSync(bundled, registry, {
    recursive: true,
    filter: (path) => {
      const [kind, id, file] = relative(bundled, path).split(sep);
      if (kind !== "stacks" && kind !== "fragments") return true;
      if (id === undefined || file === undefined) return true;
      return file === "STACK.md" || file === "FRAGMENT.md" || payloads.has(join(kind, id));
    },
  });
  const previews = async () => {
    const result = [];
    for (const preset of presets) {
      const run = await cli(
        ["validate", "--brief", "go-cli", "--json", ...(preset === "sandbox" ? ["--sandbox"] : [])],
        registry,
      );
      expect(run.status).toBe(0);
      expect(run.stderr).toBe("");
      result.push(Schema.decodeUnknownSync(BriefPreview)(JSON.parse(run.stdout)));
    }
    return result;
  };
  const before = await previews();
  const fragment = join(registry, "fragments/ci-github/FRAGMENT.md");
  writeFileSync(
    fragment,
    `${readFileSync(fragment, "utf8")}\n<!-- stacks:when stack=cloudflare-react-router -->\nKeep the Worker configuration local.\n<!-- stacks:end -->\n`,
  );
  const after = await previews();
  for (const [index, original] of before.entries()) {
    expect(after[index]?.brief).toBe(original.brief);
    // The fingerprint hashes resolved bodies, so proof for these stacks still holds.
    expect(after[index]?.fingerprint).toBe(original.fingerprint);
  }
});

test("effect-schema arrives only through effect's requires on a stack that never lists it [3.3c#2]", async () => {
  // effect applies only to effect-tagged stacks, and each lists it by default, so no stack takes
  // `--with effect` from neither. typescript-cli lists effect but not effect-schema: dropping
  // effect drops both, and the default brings effect-schema only through effect's requires.
  const baseline = await scaffold("typescript-cli", "requirements-baseline", [
    "--without",
    "effect",
    "--dry-run",
    "--sandbox",
  ]);
  for (const id of ["effect", "effect-schema"]) expect(baseline.fragments).not.toContain(id);
  const result = await scaffold("typescript-cli", "requirements", ["--dry-run", "--sandbox"]);
  expect(result.fragments.filter((id) => id === "effect" || id === "effect-schema")).toEqual([
    "effect-schema",
    "effect",
  ]);
  expect(result.warnings).toEqual([]);
  expect(existsSync(result.project)).toBe(false);
});

// Exercise the shipped installer, not a reimplementation. The local release endpoint serves
// the current binary-asset format. No provider credentials or external network are involved.
test("bun-release renders scope and rejects bad sums without replacing an existing executable [3.3a#1] [3.3a#2] [3.3a#4] [3.3a#5]", async () => {
  const fragment = releases.find((entry) => entry.id === "bun-release");
  if (!fragment) throw new Error("bundled bun-release is missing");
  const { project, manifest } = await writeFragment(fragment, "@acme");
  const installer = readFileSync(join(project, "install.sh"), "utf8");
  expect(installer).toContain("acme/matrix");
  expect(installer).not.toContain("{{package_scope}}");
  const installDir = join(home, "install destination ; ü");
  mkdirSync(installDir);
  writeFileSync(join(installDir, "matrix"), "old executable\n", { mode: 0o755 });
  const before = snapshot(installDir);
  const binary = "new executable\n";
  const expected = "0".repeat(64);
  let checksum = expected;
  const actual = sha256(binary).slice("sha256:".length);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    requests.push(url);
    if (url === "/latest/download/SHA256SUMS") {
      response.end(
        ["darwin", "linux"]
          .flatMap((os) => ["x64", "arm64"].map((arch) => `${checksum}  matrix-${os}-${arch}`))
          .join("\n"),
      );
    } else if (/^\/latest\/download\/matrix-(darwin|linux)-(x64|arm64)$/.test(url))
      response.end(binary);
    else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("release fixture has no port");
    const releaseEnv = {
      HOME: home,
      PATH: process.env.PATH ?? "",
      MATRIX_INSTALL_DIR: installDir,
      MATRIX_RELEASES_URL: `http://127.0.0.1:${address.port}`,
    };
    const install = async () => {
      const exit = await runProcesses(
        Effect.gen(function* () {
          const processes = yield* Processes;
          return yield* processes.run({
            command: `/bin/bash ${quote(join(project, "install.sh"))}`,
            cwd: project,
            env: releaseEnv,
            timeout: Duration.seconds(3),
          });
        }),
      );
      if (Exit.isFailure(exit)) throw new Error("could not execute the shipped installer");
      expect(exit.value.timedOut).toBe(false);
      return exit.value;
    };
    const rejected = await install();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.tail).toContain(expected);
    expect(rejected.tail).toContain(actual);
    expect(requests).toContain("/latest/download/SHA256SUMS");
    expect(
      requests.some((url) => /^\/latest\/download\/matrix-(darwin|linux)-(x64|arm64)$/.test(url)),
    ).toBe(true);
    expect(snapshot(installDir)).toEqual(before);
    checksum = actual;
    const installed = await install();
    expect(installed.exitCode).toBe(0);
    expect(readFileSync(join(installDir, "matrix"), "utf8")).toBe(binary);
    expect(statSync(join(installDir, "matrix")).mode & 0o111).toBe(0o111);
    expect(readdirSync(installDir)).toEqual(["matrix"]);
    // No fragment verify step runs the installer: in a real project it would reach the network
    // and the user's install directory. The project's own tests cover it against a local server.
    expect(manifest.verify.filter((step) => /install\.sh/.test(step.run))).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  // Each bounded process can need the five-second termination grace before the server closes.
}, 20_000);

test("bun-release explains what to do when package scope is empty [3.3a#4]", async () => {
  const run = await cli([
    "validate",
    "--brief",
    "typescript-cli",
    "--with",
    "bun-release",
    "--json",
  ]);
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  const preview = Schema.decodeUnknownSync(BriefPreview)(JSON.parse(run.stdout));
  const releaseBody = preview.brief.split("## Fragment: Bun binary releases")[1]?.split("\n## ")[0];
  expect(releaseBody).toBeDefined();
  expect(releaseBody).toMatch(
    /unscoped|(?:empty|no|without)\s+(?:package\s+)?scope|scope\s+is\s+empty/i,
  );
});
