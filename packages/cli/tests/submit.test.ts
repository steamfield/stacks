import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { skeleton } from "../src/core/create-text";
import { ErrorEnvelope } from "../src/errors";
import { SubmitResult } from "../src/schemas/submit";
import { runCli, tempDir } from "./helpers/cli";
import { fakeGitHub } from "./helpers/submit";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const github = fakeGitHub();
  const home = tempDir();
  cleanups.push(github.cleanup, home.cleanup);
  const user = join(home.path, "config", "stacks");
  return { github, home: home.path, user };
}

const kindDir = (kind: "stack" | "fragment") => (kind === "stack" ? "stacks" : "fragments");

/**
 * An entry as `create` scaffolds it, with its description written. A stack ships the scaffold's
 * README with its fill marker, which the stack's readme verify step makes the project's to fill.
 */
function entry(
  root: string,
  kind: "stack" | "fragment",
  id: string,
  edit: (text: string) => string = (text) => text,
) {
  const dir = join(root, kindDir(kind), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, kind === "stack" ? "STACK.md" : "FRAGMENT.md"),
    edit(skeleton(kind, id, "ci").replace(/"stacks:fill: describe the \w+"/, `"The ${id} entry."`)),
  );
  if (kind === "stack") {
    mkdirSync(join(dir, "files"));
    writeFileSync(join(dir, "files", "README.md"), "<!-- stacks:fill: describe the project -->\n");
  }
  return dir;
}

const STALE = `sha256:${"0".repeat(64)}`;
/** An author's draft card, still unreviewed, with a digest that no longer matches. */
function card(root: string, kind: "stack" | "fragment", id: string) {
  const file = join(root, "search", kindDir(kind), `${id}.json`);
  mkdirSync(dirname(file), { recursive: true });
  const fields =
    kind === "stack"
      ? { platforms: ["cli"], productKinds: ["cli-tool"], languages: ["typescript"] }
      : { capabilities: [] };
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id,
        source: { digest: STALE, by: "author", reviewedAt: null },
        summary: `The ${id} entry.`,
        requests: ["build a sample project", "start a fixture project", "check an example"],
        useCases: [],
        synonyms: [],
        goodFor: [],
        notFor: [],
        kind,
        ...fields,
      },
      null,
      2,
    )}\n`,
  );
  return file;
}

const json = (stdout: string) =>
  Schema.decodeUnknownSync(SubmitResult)(JSON.parse(stdout), { onExcessProperty: "error" });
/**
 * The last stderr line, checked against the envelope schema and returned as written: the
 * envelope's union of details shapes can decode a details object as a smaller member.
 */
function envelope(stderr: string) {
  const raw = JSON.parse(stderr.trim().split("\n").at(-1) ?? "") as unknown;
  Schema.decodeUnknownSync(ErrorEnvelope)(raw);
  return Schema.decodeUnknownSync(
    Schema.Struct({
      error: Schema.Struct({
        tag: Schema.String,
        message: Schema.String,
        retryable: Schema.Boolean,
        next: Schema.optionalKey(Schema.String),
        details: Schema.optionalKey(Schema.Unknown),
      }),
    }),
  )(raw).error;
}

/** git's subcommand, after any `-c name=value` pairs. */
function gitSubcommand(call: ReadonlyArray<string>): string | undefined {
  for (let index = 1; index < call.length; index++) {
    const arg = call[index] ?? "";
    if (arg === "-c" || arg === "-C") index++;
    else if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}
const SUBMIT_STEPS = ["clone", "checkout", "add", "diff", "commit", "ls-remote", "push"];
/** The calls submit makes for itself, without validation's read-only git lookups. */
const steps = (calls: string[][]) =>
  calls.filter((call) => call[0] === "gh" || SUBMIT_STEPS.includes(gitSubcommand(call) ?? ""));
const cloneDir = (calls: string[][]) =>
  calls.find((call) => gitSubcommand(call) === "clone")?.at(-1) ?? "";

test("submit runs preflight, clone, checks, fork, commit, leased push and a draft PR, in order", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  card(user, "stack", "demo-app");
  const run = await runCli(["submit", "demo-app", "--query", "a demo app", "--json"], {
    home,
    env: github.env,
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  const result = json(run.stdout);
  const calls = github.calls();
  const clone = cloneDir(calls);
  const temp = dirname(clone);
  const branch = "entry/stack-demo-app";
  const fork = "https://github.com/octo-author/stacks.git";
  const local = ["git", "-c", "core.hooksPath=/dev/null"];
  const credentials = [
    "git",
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=!${join(github.bin, "gh")} auth git-credential`,
  ];
  expect(steps(calls)).toEqual([
    ["gh", "auth", "status"],
    ["gh", "api", "user", "--jq", ".login"],
    [
      "git",
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--depth",
      "1",
      "--branch",
      "main",
      "--single-branch",
      "https://github.com/steamfield/stacks.git",
      join(temp, "upstream"),
    ],
    [...local, "checkout", "--quiet", "-b", branch],
    [...local, "add", "--all", "--", "packages/cli/registry"],
    [...local, "diff", "--cached", "--name-only", "-z"],
    ["gh", "repo", "fork", "steamfield/stacks", "--clone=false"],
    [...local, "commit", "--quiet", "-m", "feat(registry): add demo-app stack"],
    [...credentials, "ls-remote", fork, `refs/heads/${branch}`],
    [
      ...credentials,
      "push",
      "--quiet",
      `--force-with-lease=refs/heads/${branch}:`,
      fork,
      `HEAD:refs/heads/${branch}`,
    ],
    [
      "gh",
      "pr",
      "view",
      `octo-author:${branch}`,
      "--repo",
      "steamfield/stacks",
      "--json",
      "url,state",
      "--jq",
      'select(.state == "OPEN") | .url',
    ],
    [
      "gh",
      "pr",
      "create",
      "--draft",
      "--repo",
      "steamfield/stacks",
      "--base",
      "main",
      "--head",
      `octo-author:${branch}`,
      "--title",
      "feat(registry): add demo-app stack",
      "--body-file",
      join(temp, "body.md"),
    ],
  ]);
  expect(result).toEqual({
    repo: "steamfield/stacks",
    entries: [{ kind: "stack", id: "demo-app", update: false }],
    author: "octo-author",
    branch,
    prUrl: "https://github.com/steamfield/stacks/pull/42",
    reused: false,
    dryRun: false,
    findings: result.findings,
    files: [
      "packages/cli/registry/authors.json",
      "packages/cli/registry/search/stacks/demo-app.json",
      "packages/cli/registry/stacks/demo-app/STACK.md",
      "packages/cli/registry/stacks/demo-app/files/README.md",
    ],
  });
  expect(result.findings.filter((finding) => finding.severity !== "note")).toEqual([
    expect.objectContaining({ check: "search-unreviewed", severity: "warning" }),
  ]);
  // The pushed tree names the author and carries the entry and its card.
  const registry = join(github.pushed, "packages", "cli", "registry");
  expect(JSON.parse(readFileSync(join(registry, "authors.json"), "utf8"))).toEqual({
    "stack/demo-app": "octo-author",
  });
  expect(readFileSync(join(registry, "stacks", "demo-app", "STACK.md"), "utf8")).toBe(
    readFileSync(join(user, "stacks", "demo-app", "STACK.md"), "utf8"),
  );
  const body = github.body();
  for (const text of [
    "- stack `demo-app` (new): The demo-app entry.",
    "- `demo-app`: search-unreviewed (search/stacks/demo-app.json)",
    "- a demo app",
    "- [ ] `authors.json` names the PR author's login for every submitted entry",
    "- [ ] Golden queries added, and existing golden rankings checked for shifts",
    "- [ ] CI green before undraft",
    "Submitted by @octo-author with `stacks submit`",
  ])
    expect(body).toContain(text);
  // The temporary clone is gone once the command ends.
  expect(existsSync(temp)).toBe(false);
});

test("the card's source digest is restamped from the submitted entry", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const before = JSON.parse(readFileSync(card(user, "stack", "demo-app"), "utf8"));
  const run = await runCli(["submit", "demo-app", "--json"], { home, env: github.env });
  expect(run.status).toBe(0);
  expect(json(run.stdout).findings.map((finding) => finding.check)).not.toContain("search-stale");
  const pushed = JSON.parse(
    readFileSync(
      join(github.pushed, "packages", "cli", "registry", "search", "stacks", "demo-app.json"),
      "utf8",
    ),
  );
  expect(pushed.source.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(pushed.source.digest).not.toBe(STALE);
  // Only the digest changed, in place.
  expect({ ...pushed, source: { ...pushed.source, digest: STALE } }).toEqual(before);
  expect(Object.keys(pushed)).toEqual(Object.keys(before));
});

test("--dry-run clones and checks, then prints the files and body without forking, pushing or opening a PR", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const run = await runCli(["submit", "demo-app", "--dry-run", "--json"], {
    home,
    env: github.env,
  });
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  const result = json(run.stdout);
  expect(result.dryRun).toBe(true);
  expect(result.prUrl).toBeNull();
  expect(result.body).toContain("## Maintainer checklist");
  expect(result.files).toContain("packages/cli/registry/stacks/demo-app/STACK.md");
  const calls = github.calls();
  expect(calls.some((call) => call[0] === "gh" && call[1] !== "auth" && call[1] !== "api")).toBe(
    false,
  );
  for (const step of ["commit", "ls-remote", "push"])
    expect(calls.some((call) => gitSubcommand(call) === step)).toBe(false);
  expect(existsSync(dirname(cloneDir(calls)))).toBe(false);
});

test("--dry-run in text mode prints the file list, the body and the command to submit", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const run = await runCli(["submit", "demo-app", "--dry-run", "--query", "a demo"], {
    home,
    env: { ...github.env, CLAUDECODE: "1" },
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  expect(run.stdout).toContain("Dry run: nothing was forked, pushed or opened.");
  expect(run.stdout).toContain(
    "Would submit to steamfield/stacks as @octo-author: stack demo-app (new)",
  );
  expect(run.stdout).toContain("  packages/cli/registry/stacks/demo-app/STACK.md");
  expect(run.stdout).toContain("## Proposed search queries\n\n- a demo");
  expect(run.stdout.trimEnd().split("\n").at(-1)).toBe(
    "Next: show the user this dry run; once they agree, run stacks submit demo-app --query 'a demo'",
  );
});

test("a stack and its fragment go into one pull request named after the first entry", async () => {
  const { github, home, user } = setup();
  entry(user, "fragment", "demo-lint");
  const stack = entry(user, "stack", "demo-app", (text) =>
    text.replace("required: []", "required: [demo-lint]"),
  );
  const run = await runCli(["submit", stack, "demo-lint", "--json"], { home, env: github.env });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  const result = json(run.stdout);
  expect(result.entries).toEqual([
    { kind: "stack", id: "demo-app", update: false },
    { kind: "fragment", id: "demo-lint", update: false },
  ]);
  expect(result.branch).toBe("entry/stack-demo-app");
  expect(result.files).toContain("packages/cli/registry/fragments/demo-lint/FRAGMENT.md");
  const creates = github.calls().filter((call) => call[0] === "gh" && call[2] === "create");
  expect(creates).toHaveLength(1);
  expect(creates[0]).toContain("feat(registry): add demo-app stack, add demo-lint fragment");
  expect(
    JSON.parse(readFileSync(join(github.pushed, "packages/cli/registry/authors.json"), "utf8")),
  ).toEqual({ "fragment/demo-lint": "octo-author", "stack/demo-app": "octo-author" });
});

test("references resolve against the upstream clone, not the author's own registries", async () => {
  const { github, home, user } = setup();
  // ci-github is upstream; demo-local exists only in the author's user registry.
  entry(user, "fragment", "demo-local");
  entry(user, "stack", "uses-upstream", (text) =>
    text.replace("optional: []", "optional: [ci-github]"),
  );
  entry(user, "stack", "uses-local", (text) =>
    text.replace("optional: []", "optional: [demo-local]"),
  );
  const upstream = await runCli(["submit", "uses-upstream", "--dry-run", "--json"], {
    home,
    env: github.env,
  });
  expect(upstream.stderr).toBe("");
  expect(upstream.status).toBe(0);
  const local = await runCli(["submit", "uses-local", "--dry-run", "--json"], {
    home,
    env: github.env,
  });
  expect(local.status).toBe(2);
  expect(local.stdout).toBe("");
  const error = envelope(local.stderr);
  expect(error.tag).toBe("BadInput");
  expect(error.details).toEqual({
    flag: "submission",
    blockers: [expect.objectContaining({ kind: "stack", id: "uses-local", severity: "error" })],
  });
});

test("the readiness bar lets maintainer-only warnings through and blocks any other warning or error", async () => {
  const { github, home, user } = setup();
  // No card at all: search-missing and missing-card, both left to maintainers.
  entry(user, "stack", "no-card");
  const allowed = await runCli(["submit", "no-card", "--dry-run", "--json"], {
    home,
    env: github.env,
  });
  expect(allowed.status).toBe(0);
  expect(
    json(allowed.stdout)
      .findings.filter((finding) => finding.severity === "warning")
      .map((finding) => finding.check)
      .sort(),
  ).toEqual(["missing-card", "search-missing"]);

  const home2 = ["", "Users", "someone", "project"].join("/");
  entry(user, "stack", "with-path", (text) => `${text}\nSee ${home2}/notes.\n`);
  const warned = await runCli(["submit", "with-path", "--dry-run", "--json"], {
    home,
    env: github.env,
  });
  expect(warned.status).toBe(2);
  expect(warned.stdout).toBe("");
  expect(envelope(warned.stderr)).toMatchObject({
    tag: "BadInput",
    message: "Invalid input.",
    details: {
      flag: "submission",
      blockers: [
        {
          kind: "stack",
          id: "with-path",
          check: "absolute-path",
          severity: "warning",
          file: "stacks/with-path/STACK.md",
        },
      ],
    },
  });
  expect(envelope(warned.stderr).next).toBe(
    "run stacks validate <entry dir> --submission for each finding's message, fix them, then run stacks submit again.",
  );

  const leftover = entry(user, "fragment", "half-done");
  writeFileSync(
    join(leftover, "FRAGMENT.md"),
    readFileSync(join(leftover, "FRAGMENT.md"), "utf8").replace(
      '"The half-done entry."',
      '"stacks:fill: describe the fragment"',
    ),
  );
  const blocked = await runCli(["submit", "half-done", "--dry-run"], {
    home,
    env: { ...github.env, CLAUDECODE: "1" },
  });
  expect(blocked.status).toBe(2);
  expect(blocked.stdout).toBe("");
  expect(blocked.stderr).toBe(
    [
      "Invalid input.",
      "  Blocked: fragment half-done: fill-marker (error) at fragments/half-done/FRAGMENT.md:6",
      "  Next: run stacks validate <entry dir> --submission for each finding's message, fix them, then run stacks submit again.",
      "",
    ].join("\n"),
  );
  // Nothing past the checks ran.
  expect(github.calls().some((call) => call[0] === "gh" && call[1] === "repo")).toBe(false);
});

test("an id the upstream registry has is refused for another author", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "go-api");
  const run = await runCli(["submit", "go-api", "--json"], { home, env: github.env });
  expect(run.status).toBe(2);
  expect(run.stdout).toBe("");
  expect(envelope(run.stderr)).toMatchObject({
    tag: "BadInput",
    details: { flag: "collision", kind: "stack", id: "go-api", removed: false },
    next: "pick another id for your entry (ids are permanent), or ask its author to submit the change.",
  });

  writeFileSync(
    join(github.registry, "authors.json"),
    `${JSON.stringify({ "stack/go-api": "someone-else" })}\n`,
  );
  const owned = await runCli(["submit", "go-api", "--json"], { home, env: github.env });
  expect(owned.status).toBe(2);
  expect(envelope(owned.stderr).details).toEqual({
    flag: "collision",
    kind: "stack",
    id: "go-api",
    removed: false,
    owner: "someone-else",
  });
  expect(github.calls().some((call) => call[0] === "gh" && call[1] === "repo")).toBe(false);
});

test("an id the registry removed is refused", async () => {
  const { github, home, user } = setup();
  writeFileSync(
    join(github.registry, "removed.json"),
    JSON.stringify({
      schemaVersion: 1,
      entries: { "old-api": { kind: "stack", removedAt: "2026-10-01", reason: "Renamed." } },
    }),
  );
  entry(user, "stack", "old-api");
  const run = await runCli(["submit", "old-api", "--json"], { home, env: github.env });
  expect(run.status).toBe(2);
  expect(envelope(run.stderr).details).toEqual({
    flag: "collision",
    kind: "stack",
    id: "old-api",
    removed: true,
  });
});

test("the author named in authors.json submits an update to their entry", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  // Upstream already has demo-app from this author, with a file the new version drops.
  entry(github.registry, "stack", "demo-app");
  writeFileSync(join(github.registry, "stacks", "demo-app", "files", "OLD.md"), "old\n");
  writeFileSync(
    join(github.registry, "authors.json"),
    `${JSON.stringify({ "stack/demo-app": "octo-author", "stack/go-api": "maintainer" }, null, 2)}\n`,
  );
  writeFileSync(
    join(user, "stacks", "demo-app", "STACK.md"),
    readFileSync(join(user, "stacks", "demo-app", "STACK.md"), "utf8").replace(
      "Describe the test strategy.",
      "Run the unit tests first.",
    ),
  );
  const run = await runCli(["submit", "demo-app", "--json"], { home, env: github.env });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  const result = json(run.stdout);
  expect(result.entries).toEqual([{ kind: "stack", id: "demo-app", update: true }]);
  expect(result.files).toEqual([
    "packages/cli/registry/stacks/demo-app/STACK.md",
    "packages/cli/registry/stacks/demo-app/files/OLD.md",
  ]);
  expect(
    existsSync(join(github.pushed, "packages/cli/registry/stacks/demo-app/files/OLD.md")),
  ).toBe(false);
  expect(github.calls().find((call) => gitSubcommand(call) === "commit")).toContain(
    "feat(registry): update demo-app stack",
  );
});

test("a rerun leases the push on the fork's branch and reuses the open pull request", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const url = "https://github.com/steamfield/stacks/pull/7";
  const run = await runCli(["submit", "demo-app", "--json"], {
    home,
    env: { ...github.env, FAKE_GH_PR: url, FAKE_REMOTE_SHA: "abc123" },
  });
  expect(run.status).toBe(0);
  const result = json(run.stdout);
  expect(result.prUrl).toBe(url);
  expect(result.reused).toBe(true);
  const calls = github.calls();
  expect(calls.find((call) => gitSubcommand(call) === "push")).toContain(
    "--force-with-lease=refs/heads/entry/stack-demo-app:abc123",
  );
  expect(calls.some((call) => call[0] === "gh" && call[2] === "create")).toBe(false);
});

test("submit refuses offline mode before running anything", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  for (const [args, env] of [
    [["submit", "demo-app", "--offline", "--json"], github.env],
    [["submit", "demo-app", "--json"], { ...github.env, STACKS_OFFLINE: "1" }],
  ] as const) {
    const run = await runCli(args, { home, env });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(envelope(run.stderr)).toMatchObject({
      tag: "BadInput",
      details: { flag: "offline", command: "submit" },
      next: "run stacks submit without --offline and with STACKS_OFFLINE unset.",
    });
  }
  expect(github.calls()).toEqual([]);
});

test("submit needs gh on PATH, logged in", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const empty = tempDir();
  cleanups.push(empty.cleanup);
  const missing = await runCli(["submit", "demo-app", "--json"], {
    home,
    env: { ...github.env, PATH: empty.path },
  });
  expect(missing.status).toBe(2);
  expect(envelope(missing.stderr)).toMatchObject({
    tag: "BadInput",
    details: { flag: "tool", tool: "gh", reason: "missing" },
    next: "install the GitHub CLI (https://cli.github.com) and run gh auth login, then run stacks submit again.",
  });
  expect(github.calls()).toEqual([]);

  const loggedOut = await runCli(["submit", "demo-app"], {
    home,
    env: { ...github.env, FAKE_GH_AUTH: "1", CLAUDECODE: "1" },
  });
  expect(loggedOut.status).toBe(2);
  expect(loggedOut.stdout).toBe("");
  expect(loggedOut.stderr).toBe(
    [
      "Invalid input.",
      "  gh is not logged in to GitHub.",
      "  Next: run gh auth login, then run stacks submit again.",
      "",
    ].join("\n"),
  );
  expect(github.calls()).toEqual([["gh", "auth", "status"]]);
});

test("a repository GitHub doesn't have is bad input, and an unreachable one is retryable", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const unknown = await runCli(["submit", "demo-app", "--repo", "nobody/nothing", "--json"], {
    home,
    env: { ...github.env, FAKE_CLONE_FAIL: "remote: Repository not found." },
  });
  expect(unknown.status).toBe(2);
  expect(envelope(unknown.stderr).details).toEqual({ flag: "repo", value: "nobody/nothing" });

  const down = await runCli(["submit", "demo-app", "--json"], {
    home,
    env: { ...github.env, FAKE_CLONE_FAIL: "fatal: unable to access: Could not resolve host" },
  });
  expect(down.status).toBe(4);
  expect(envelope(down.stderr)).toMatchObject({
    tag: "UpstreamUnavailable",
    retryable: true,
    details: { service: "github", step: "clone" },
  });

  const malformed = await runCli(["submit", "demo-app", "--repo", "not a repo", "--json"], {
    home,
    env: github.env,
  });
  expect(malformed.status).toBe(2);
  expect(envelope(malformed.stderr).details).toEqual({ flag: "repo", value: "not a repo" });
});

test("a failure after the clone still removes the temporary clone", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const denied = await runCli(["submit", "demo-app", "--json"], {
    home,
    env: { ...github.env, FAKE_GH_FORK_FAIL: "HTTP 403: Must have admin rights to Repository." },
  });
  expect(denied.status).toBe(6);
  expect(envelope(denied.stderr)).toMatchObject({
    tag: "PermissionDenied",
    details: { reason: "github" },
  });
  expect(existsSync(dirname(cloneDir(github.calls())))).toBe(false);

  const unreachable = await runCli(["submit", "demo-app", "--json"], {
    home,
    env: { ...github.env, FAKE_PUSH_FAIL: "fatal: unable to access: Could not resolve host" },
  });
  expect(unreachable.status).toBe(4);
  expect(envelope(unreachable.stderr).details).toEqual({ service: "github", step: "push" });
  const clones = github.calls().filter((call) => gitSubcommand(call) === "clone");
  expect(clones).toHaveLength(2);
  for (const clone of clones) expect(existsSync(dirname(clone.at(-1) ?? ""))).toBe(false);
});

test("Ctrl+C during the fork stops with 130 and removes the temporary clone", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "demo-app");
  const controller = new AbortController();
  const running = runCli(["submit", "demo-app", "--json"], {
    home,
    env: { ...github.env, FAKE_GH_FORK_SLEEP: "30" },
    signal: controller.signal,
  });
  await vi.waitFor(
    () => expect(github.calls().some((call) => call[0] === "gh" && call[1] === "repo")).toBe(true),
    { timeout: 10_000 },
  );
  const temp = dirname(cloneDir(github.calls()));
  expect(existsSync(temp)).toBe(true);
  controller.abort();
  const run = await running;
  expect(run.status).toBe(130);
  expect(run.stdout).toBe("");
  expect(existsSync(temp)).toBe(false);
});

test("an id both kinds use in the user registry, or a registry root, needs one entry directory", async () => {
  const { github, home, user } = setup();
  entry(user, "stack", "twin");
  entry(user, "fragment", "twin");
  const twin = await runCli(["submit", "twin", "--json"], { home, env: github.env });
  expect(twin.status).toBe(2);
  expect(envelope(twin.stderr).details).toEqual({ id: "twin", flag: "submit_entry" });
  const root = await runCli(["submit", user, "--json"], { home, env: github.env });
  expect(root.status).toBe(2);
  expect(envelope(root.stderr).details).toEqual({ id: user, flag: "submit_entry" });
  const typo = await runCli(["submit", "twinn", "--json"], { home, env: github.env });
  expect(typo.status).toBe(2);
  expect(envelope(typo.stderr)).toMatchObject({
    tag: "NotFound",
    details: { id: "twinn", suggestions: ["twin"] },
  });
  expect(github.calls()).toEqual([]);
});
