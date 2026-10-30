import { Clock, Duration, Effect, FileSystem, Option, Path, Schema } from "effect";
import { AppConfig, type Environment } from "../../src/config";
import { type ComposeOptions, compose } from "../../src/core/compose/compose";
import { fingerprint } from "../../src/core/fingerprint";
import { readManifest } from "../../src/core/manifest";
import { Registry } from "../../src/core/registry/registry";
import { NewResult } from "../../src/schemas/new";
import { Host } from "../../src/services/host";
import { type Captured, Processes } from "../../src/services/processes";
import type { AgentAdapter } from "./agents";
import { freePort, shellArg, snapshot } from "./files";
import type { Options } from "./options";

const State = Schema.fromJsonString(
  Schema.Struct({
    with: Schema.Array(Schema.String),
    ports: Schema.Record(Schema.String, Schema.String),
    fixedWords: Schema.Number,
    note: Schema.optionalKey(
      Schema.String.check(Schema.isPattern(/^plans\/runs\/[A-Za-z0-9._-]+\.md$/)),
    ),
  }),
);

const requireSuccess = (result: Captured, label: string) =>
  result.exitCode === 0 && !result.timedOut && !result.truncated
    ? Effect.succeed(result.stdout.trim())
    : Effect.fail(new Error(`${label} failed: ${result.stderr || result.stdout}`));

export const prepare = (options: Options, adapters: readonly AgentAdapter[]) =>
  Effect.gen(function* () {
    const date = new Date(yield* Clock.currentTimeMillis).toISOString().slice(0, 10);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const host = yield* Host;
    const config = yield* AppConfig;
    const processes = yield* Processes;
    const captured = config.childEnv([]);
    const detected = yield* config.agent;
    const chosen = chosenAgent(options, adapters, detected);
    const findAgent = Effect.gen(function* () {
      const adapter = adapters.find((a) => a.id === chosen);
      if (!adapter) return yield* Effect.fail(new Error(`Unsupported agent: ${chosen}`));
      const credentials = yield* resolveCredentials(adapter, captured, fs, path);
      const found = yield* processes.which(adapter.binary);
      if (Option.isNone(found))
        return yield* Effect.fail(new Error(`${adapter.binary} is not on PATH`));

      return { adapter, credentials, found };
    });
    const { adapter, credentials, found } = yield* findAgent;

    // Construct every environment through config, retaining only the explicit allowlist.
    const environment = (set: Record<string, string> = {}) =>
      config.childEnv(Object.keys(captured), {
        ...Object.fromEntries(
          ["PATH", "TMPDIR", "LANG"].flatMap((key) =>
            captured[key] === undefined ? [] : [[key, captured[key]]],
          ),
        ),
        DO_NOT_TRACK: "1",
        ...set,
      });
    const preflightEnv = environment(captured.HOME ? { HOME: captured.HOME } : {});
    const exec = (argv: readonly [string, ...string[]], cwd = host.cwd) =>
      processes
        .exec({ argv, cwd, env: preflightEnv, timeout: Duration.seconds(60) })
        .pipe(Effect.flatMap((result) => requireSuccess(result, argv[0])));
    const resolveNode = Effect.gen(function* () {
      const node = yield* processes.which("node");
      if (Option.isNone(node))
        return yield* Effect.fail(new Error("Node 22 or newer is required on PATH"));
      const executable = yield* exec([node.value, "-p", "process.execPath"]);
      const version = yield* exec([executable, "--version"]);
      if (Number(version.match(/^v(\d+)\./)?.[1] ?? 0) < 22)
        return yield* Effect.fail(new Error("Node 22 or newer is required on PATH"));
      return executable;
    });
    const nodeExecutable = yield* resolveNode;
    const version = yield* exec([found.value, ...adapter.versionArgs]);
    const agentVersion = version.match(/\d+\.\d+[^\s)]*/)?.[0] ?? version;
    if (!agentVersion) return yield* Effect.fail(new Error("Agent version is empty"));
    const repo = yield* exec(["git", "rev-parse", "--show-toplevel"]);
    const repoCommit = yield* exec(["git", "rev-parse", "HEAD"], repo);
    const dirty = yield* exec(["git", "status", "--porcelain", "--", "packages/cli/"], repo);
    if (dirty) return yield* Effect.fail(new Error("Uncommitted changes under packages/cli/"));
    const packageRoot = path.join(repo, "packages/cli");
    const registry = path.join(packageRoot, "registry");
    const selection: ComposeOptions = {
      stack: options.stack,
      with: options.with,
      without: [],
      preset: options.preset,
      agents: [adapter.id],
      always: [],
      mode: "new",
    };
    const { composition, added } = yield* Effect.gen(function* () {
      const composition = yield* compose(selection);
      const baseline = yield* compose({ ...selection, with: [] });
      const defaults = new Set(baseline.fragments.map((entry) => entry.id));
      return {
        composition,
        added: options.with.filter(
          (id) => !defaults.has(id) && composition.fragments.some((entry) => entry.id === id),
        ),
      };
    }).pipe(Effect.provide(Registry.layer([{ origin: "bundled", path: registry }])));

    let scaffold: NewResult | undefined;
    const checkExistingSelection = (kept: {
      manifest: Effect.Success<ReturnType<typeof readManifest>>;
      state: typeof State.Type;
    }) =>
      Effect.gen(function* () {
        if (
          kept.manifest.stack?.id !== options.stack ||
          kept.manifest.preset !== options.preset ||
          kept.manifest.agents.length !== 1 ||
          kept.manifest.agents[0] !== adapter.id ||
          JSON.stringify(kept.state.with) !== JSON.stringify(added)
        )
          return yield* Effect.fail(
            new Error("Existing stack, fragments, preset or agent do not match"),
          );
      });
    const openWorkspace = Effect.gen(function* () {
      let root: string;
      let ports: Record<string, string>;
      let fixedWords: number;
      let previousNote: string | undefined;
      if (options.existing) {
        root = yield* fs.realPath(path.resolve(host.cwd, options.existing));
        const kept = yield* Effect.gen(function* () {
          const manifest = yield* readManifest(path.join(root, "run/.stacks/manifest.json"));
          const state = yield* fs
            .readFileString(path.join(root, "bench/state.json"))
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(State)));
          return { manifest, state };
        }).pipe(Effect.mapError(() => new Error("Invalid existing bench manifest or kept state")));
        yield* checkExistingSelection(kept);
        const current = yield* fingerprint(composition).pipe(
          Effect.provide(Registry.layer([{ origin: "bundled", path: registry }])),
        );
        if (kept.manifest.fingerprint !== current)
          return yield* Effect.fail(
            new Error("Existing fingerprint differs from current composition"),
          );
        ports = { ...kept.state.ports };
        fixedWords = kept.state.fixedWords;
        previousNote = kept.state.note;
      } else {
        const created = yield* Effect.acquireRelease(
          fs.makeTempDirectory({
            ...(captured.TMPDIR ? { directory: captured.TMPDIR } : {}),
            prefix: "stacks-bench-",
          }),
          (directory) =>
            options.keep
              ? Effect.void
              : fs.remove(directory, { recursive: true }).pipe(Effect.orDie),
        );
        // The real path, so every path the agent is given matches what `pwd` prints there
        // (macOS's TMPDIR is under /var, a symlink to /private/var).
        root = yield* fs.realPath(created);
        ports = {};
        fixedWords = 0;
      }
      return { root, ports, fixedWords, previousNote };
    });
    const workspace = yield* openWorkspace;
    const { root, ports, previousNote } = workspace;
    let fixedWords = workspace.fixedWords;
    if (options.existing && !options.keep)
      yield* Effect.addFinalizer(() => fs.remove(root, { recursive: true }).pipe(Effect.orDie));
    const home = path.join(root, "home");
    const prefix = path.join(root, "prefix");
    const cli = path.join(prefix, "bin/stacks");
    const project = path.join(root, "run");
    const bench = path.join(root, "bench");
    const env = environment({
      PATH: `${path.join(prefix, "bin")}:${path.dirname(nodeExecutable)}:${captured.PATH ?? "/usr/bin:/bin"}`,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_STATE_HOME: path.join(home, "state"),
      XDG_CACHE_HOME: path.join(home, "cache"),
    });
    const allocatePorts = Effect.gen(function* () {
      for (const key of Object.keys(composition.env)
        .filter((key) => key.startsWith("PORT_"))
        .sort()) {
        let port: string;
        do {
          port = yield* freePort();
        } while (Object.values(ports).includes(port));
        ports[key] = port;
      }
    });
    const scaffoldFresh = Effect.gen(function* () {
      for (const directory of [
        home,
        bench,
        path.join(prefix, "bin"),
        ...Object.entries(env)
          .filter(([key]) => key.startsWith("XDG_"))
          .map(([, value]) => value),
      ])
        yield* fs.makeDirectory(directory, { recursive: true });
      yield* allocatePorts;
      if (!options.cli) yield* exec(["bun", "run", "build"], repo);
      const entry = options.cli
        ? path.resolve(host.cwd, options.cli)
        : path.join(packageRoot, "dist/stacks");
      const installed = path.join(prefix, "dist/stacks");
      yield* fs.makeDirectory(path.dirname(installed), { recursive: true });
      yield* fs.copyFile(entry, installed);
      yield* fs.copyFile(
        path.join(path.dirname(entry), "cli.mjs"),
        path.join(prefix, "dist/cli.mjs"),
      );
      yield* fs.writeFileString(
        cli,
        `#!/bin/sh\nexec ${shellArg(nodeExecutable)} ${shellArg(installed)} "$@"\n`,
      );
      yield* fs.chmod(cli, 0o755);
      yield* fs.copy(registry, path.join(prefix, "registry"));
      yield* fs.copy(path.join(packageRoot, "skills"), path.join(prefix, "skills"));
      yield* fs.makeDirectory(path.join(prefix, "docs"), { recursive: true });
      yield* fs.copyFile(
        path.join(packageRoot, "docs/authoring.md"),
        path.join(prefix, "docs/authoring.md"),
      );
      scaffold = yield* processes
        .exec({
          argv: [
            cli,
            "new",
            options.stack,
            "run",
            options.preset === "sandbox" ? "--sandbox" : "--yes",
            "--agents",
            adapter.id,
            "--no-launch",
            "--json",
            ...(options.with.length ? ["--with", options.with.join(",")] : []),
          ],
          cwd: root,
          env: { ...env, ...ports },
          timeout: Duration.minutes(2),
        })
        .pipe(
          Effect.flatMap((result) => requireSuccess(result, "new")),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(NewResult))),
        );
      fixedWords = scaffold.fixedWords;
      yield* fs.writeFileString(
        path.join(bench, "state.json"),
        JSON.stringify({
          with: added,
          ports,
          fixedWords,
        }),
      );
      yield* fs.writeFileString(
        path.join(bench, "verify"),
        `#!/bin/sh\ndate -u +%Y-%m-%dT%H:%M:%SZ >> ${shellArg(path.join(bench, "verify.log"))}; exec env ${Object.entries(
          ports,
        )
          .map(([key, value]) => shellArg(`${key}=${value}`))
          .join(" ")} ${shellArg(cli)} verify "$@"\n`,
      );
      yield* fs.chmod(path.join(bench, "verify"), 0o755);
      yield* fs.writeFileString(
        path.join(bench, "BENCH.md"),
        `# Bench run

- Nobody will answer you. Never ask the user a question. Choose the brief's default or the most conventional choice and carry on. Add each question under ## Asked in .stacks/NOTES.md, followed by default: and your choice.
- Keep .stacks/NOTES.md as the brief describes, including ## Findings.
- Run verify with ${path.join(bench, "verify")}.
- Never edit .stacks/manifest.json. Never fake a credential or stub a service the brief says to use for real.
- Stop when verify is green.
`,
      );
    });
    if (!options.existing) yield* scaffoldFresh;
    const manifest = yield* readManifest(path.join(project, ".stacks/manifest.json"));
    const runEvidence = Effect.gen(function* () {
      return {
        // Fresh runs keep precisely what new returned; continuations retain that manifest.
        fingerprint: scaffold?.fingerprint ?? manifest.fingerprint ?? "",
        briefWords: scaffold?.briefWords ?? manifest.briefWords,
        cliVersion: manifest.cli,
        before: yield* snapshot(project),
        shippedHooks: composition.files
          .filter((file) => file.path.startsWith(`.${adapter.id}/hooks/`))
          .map((file) => path.basename(file.path)),
      };
    });
    return {
      options,
      date,
      added,
      adapter,
      binary: found.value,
      agentVersion,
      repo,
      repoCommit,
      registry,
      root,
      home,
      project,
      bench,
      cli,
      env: { ...env, ...ports },
      credentials,
      ports,
      fixedWords,
      previousNote,
      ...(yield* runEvidence),
      agentChoice: agentChoice(options.agent, detected === chosen),
    };
  });

export type Prepared = Effect.Success<ReturnType<typeof prepare>>;

type Credentials = { route: "token"; token: string } | { route: "codex login"; source: string };

const resolveCredentials = (
  adapter: AgentAdapter,
  captured: Environment,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) =>
  Effect.gen(function* () {
    const token = captured[adapter.auth.env];
    if (token?.trim()) return { route: "token", token } satisfies Credentials;
    if (adapter.id === "codex" && captured.HOME) {
      const source = path.join(captured.HOME, ".codex/auth.json");
      if (yield* fs.exists(source)) return { route: "codex login", source } satisfies Credentials;
    }
    return yield* Effect.fail(
      new Error(
        `Set ${adapter.auth.env} using ${adapter.auth.obtain}${adapter.id === "codex" ? ", or sign in using codex login" : ""}`,
      ),
    );
  });

function agentChoice(explicit: Options["agent"], detected: boolean): string {
  if (explicit) return "explicit --agent";
  if (detected) return "detected agent marker";
  return "default fallback to claude";
}

function chosenAgent(options: Options, adapters: readonly AgentAdapter[], detected: string) {
  return options.agent ?? (adapters.some((a) => a.id === detected) ? detected : "claude");
}
