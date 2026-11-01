import { homedir } from "node:os";
import { AgentId, type DetectedAgent } from "@steamfield/stacks-format";
import { Config, ConfigProvider, Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { InvalidConfig } from "./errors";
import { Settings } from "./schemas";
import { SLUG } from "./version";
export type Environment = Record<string, string | undefined>;
export type Paths = {
  home: string;
  config: string;
  data: string;
  cache: string;
  /**
   * Out-of-project state, such as project state records: STACKS_STATE_DIR, else
   * `$XDG_STATE_HOME/stacks/`.
   */
  state: string;
  /** The user registry root, beside config.json: `$XDG_CONFIG_HOME/stacks/`. */
  user: string;
  /**
   * STACKS_REGISTRY_DIR as given: replaces `Host.registry` as the bundled root when set.
   * `registry.ts::bundledRoot` resolves it against `Host.cwd`.
   */
  registry?: string;
};
export type LogSettings = {
  level: "Trace" | "Debug" | "Info" | "Warn" | "Error" | "Fatal" | "None";
  format: "human" | "json";
  file: string;
  noColor: boolean;
};
/**
 * One agent session marker: the environment variable `name`, set and non-empty (and equal to
 * `equals` when given), means `agent`; `"by-value"` reads the agent from the value itself.
 * `confirmed` is the date the marker was last checked against the agent's documentation; it is
 * unset until someone has checked (none has been yet; the 1.2b plan lists them for 1.3b).
 */
const AgentMarker = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*$/, { expected: "a variable name" })),
  agent: Schema.Union([AgentId, Schema.Literal("by-value")]),
  equals: Schema.optionalKey(Schema.String),
  confirmed: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { expected: "a date" })),
  ),
});
export type AgentMarker = typeof AgentMarker.Type;
const marker = (name: string, agent: AgentMarker["agent"], equals?: string) => ({
  name,
  agent,
  ...(equals === undefined ? {} : { equals }),
});
/**
 * Agent detection's markers, checked in order; the first match wins. `AI_AGENT` is the
 * cross-agent convention: its value is matched by prefix against the known ids, and any other
 * non-empty value is `"other"`. Cursor's trace id variable isn't here because its integrated
 * terminal sets it for people too.
 */
export const AgentMarkers: ReadonlyArray<AgentMarker> = Schema.decodeUnknownSync(
  Schema.Array(AgentMarker),
)([
  marker("CLAUDECODE", "claude"),
  marker("CLAUDE_CODE", "claude"),
  marker("CODEX_SANDBOX", "codex"),
  marker("CODEX_CI", "codex"),
  marker("CODEX_THREAD_ID", "codex"),
  marker("OPENCODE", "opencode"),
  marker("OPENCODE_CLIENT", "opencode"),
  marker("CURSOR_AGENT", "cursor"),
  marker("CURSOR_EXTENSION_HOST_ROLE", "cursor", "agent-exec"),
  marker("AI_AGENT", "by-value"),
]);
/** Every marker variable: `childEnv`'s `remove` list for a verify step's environment (1.3a). */
export const AGENT_MARKER_NAMES: ReadonlyArray<string> = [
  ...new Set(AgentMarkers.map((item) => item.name)),
];
/** CLI settings, shared by their readers and verify's child-environment removal list. */
const CLI_ENV = {
  logLevel: "LOG_LEVEL",
  dataDir: "STACKS_DATA_DIR",
  stateDir: "STACKS_STATE_DIR",
  registryDir: "STACKS_REGISTRY_DIR",
  logFormat: "STACKS_LOG_FORMAT",
  logFile: "STACKS_LOG_FILE",
  offline: "STACKS_OFFLINE",
  telemetryDisabled: "STACKS_TELEMETRY_DISABLED",
  telemetryDebug: "STACKS_TELEMETRY_DEBUG",
  telemetryUrl: "STACKS_TELEMETRY_URL",
  indexUrl: "STACKS_INDEX_URL",
  devApiUrl: "STACKS_DEV_API_URL",
} as const;
/**
 * The settings verify removes from a step's environment. `LOG_LEVEL` stays: projects read the same
 * name for their own logging, and a person running `LOG_LEVEL=debug stacks verify` means it for them.
 */
export const CLI_SETTING_NAMES: ReadonlyArray<string> = Object.values(CLI_ENV).filter(
  (name) => name !== CLI_ENV.logLevel,
);
/**
 * The variables that point git at a repository, work tree, index or object store instead of
 * letting it discover one from its working directory: `childEnv`'s `remove` list for the CLI's
 * own git calls. A git hook or alias exports `GIT_DIR` (and a pre-commit hook `GIT_INDEX_FILE`),
 * so `new` run from one would otherwise inspect or initialize the caller's repository. The
 * discovery limits (`GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`) select nothing
 * and stay, as do settings such as `GIT_CONFIG_GLOBAL`.
 */
export const GIT_REPOSITORY_VARIABLES: ReadonlyArray<string> = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
];
/** The agent `env` names, by `AgentMarkers` in order; a blank value counts as unset. */
export function detectAgent(env: Environment): DetectedAgent {
  for (const item of AgentMarkers) {
    const value = env[item.name];
    if (!value) continue;
    if (item.equals !== undefined && value !== item.equals) continue;
    if (item.agent !== "by-value") return item.agent;
    const named = value.toLowerCase();
    return AgentId.literals.find((id) => named.startsWith(id)) ?? "other";
  }
  return "none";
}
function provider(env: Environment) {
  return ConfigProvider.layer(
    ConfigProvider.fromEnvRecord(
      Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")),
    ),
  );
}
const text = (key: string, fallback = "") => Config.String(key).pipe(Config.withDefault(fallback));
/** Facts fixed when the CLI is built: bin supplies them; source builds and tests use `SOURCE_BUILD`. */
export type Build = { releaseBuild: boolean; defaultApiUrl: string | undefined };
export const SOURCE_BUILD: Build = { releaseBuild: false, defaultApiUrl: undefined };
export function configLayer(env: Environment | undefined, build: Build) {
  const { releaseBuild, defaultApiUrl } = build;
  const captured = { ...(env ?? process.env) };
  return Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const read = <A>(program: Config.Config<A>) =>
        program.pipe(Effect.provide(provider(captured)), Effect.orDie);
      const paths = Effect.gen(function* () {
        const home = yield* read(text("HOME", homedir()));
        const xdg = (key: string, ...fallback: string[]) =>
          read(text(key, path.join(home, ...fallback)));
        const config = yield* xdg("XDG_CONFIG_HOME", ".config");
        const data = yield* read(
          text(CLI_ENV.dataDir, path.join(yield* xdg("XDG_DATA_HOME", ".local", "share"), SLUG)),
        );
        const cache = path.join(yield* xdg("XDG_CACHE_HOME", ".cache"), SLUG);
        const state = yield* read(
          text(CLI_ENV.stateDir, path.join(yield* xdg("XDG_STATE_HOME", ".local", "state"), SLUG)),
        );
        const registry = yield* read(text(CLI_ENV.registryDir));
        return {
          config: path.join(config, SLUG, "config.json"),
          home,
          data,
          cache,
          state,
          user: path.join(config, SLUG),
          ...(registry ? { registry } : {}),
        };
      });
      const settings = Effect.gen(function* () {
        const locations = yield* paths;
        const exists = yield* fs.exists(locations.config);
        if (!exists) return {};
        const raw = yield* fs.readFileString(locations.config);
        const unknown = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: () => new InvalidConfig(),
        });
        return yield* Schema.decodeUnknownEffect(Settings, { onExcessProperty: "error" })(unknown);
      }).pipe(Effect.mapError(() => new InvalidConfig()));
      const get = yield* Effect.cached(
        Effect.gen(function* () {
          const locations = yield* paths;
          const file = yield* settings;
          const override = yield* read(text(CLI_ENV.dataDir));
          return { ...file, dataDir: override || file.dataDir || locations.data };
        }).pipe(Effect.mapError(() => new InvalidConfig())),
      );
      const logging = Effect.gen(function* () {
        const raw = (yield* read(text(CLI_ENV.logLevel, "warn"))).toLowerCase();
        const levels: Readonly<Record<string, LogSettings["level"]>> = {
          trace: "Trace",
          debug: "Debug",
          info: "Info",
          warn: "Warn",
          error: "Error",
          fatal: "Fatal",
          none: "None",
        };
        // Own keys only: `constructor` or `__proto__` would otherwise read Object.prototype.
        const level = (Object.hasOwn(levels, raw) ? levels[raw] : undefined) ?? "Warn";
        const format = yield* read(text(CLI_ENV.logFormat));
        return {
          level,
          format: format === "json" ? ("json" as const) : ("human" as const),
          file: yield* read(text(CLI_ENV.logFile)),
          noColor: Boolean(yield* read(text("NO_COLOR"))),
        };
      });
      // A child's whole environment: what was captured, minus `remove`, plus `set`. Nothing is
      // inherited from the live process environment.
      const childEnv = (remove: readonly string[], set: Record<string, string> = {}) => {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(captured))
          if (value !== undefined && !remove.includes(key)) env[key] = value;
        return { ...env, ...set };
      };
      const agent = Effect.sync(() => detectAgent(captured));
      const color = Effect.succeed({
        noColor: Boolean(captured.NO_COLOR),
        forceColor: captured.FORCE_COLOR === "1",
      });
      let offlineFlag = false;
      const offline = Effect.sync(() => offlineFlag || captured[CLI_ENV.offline] === "1");
      const setOffline = (value: boolean) =>
        Effect.sync(() => {
          offlineFlag = value;
        });
      let telemetryFlag = false;
      const noTelemetry = Effect.sync(() => telemetryFlag);
      const setNoTelemetry = (value: boolean) =>
        Effect.sync(() => {
          telemetryFlag = value;
        });
      const switchedOff = (value: string | undefined) =>
        value !== undefined && !["", "0", "false"].includes(value);
      const telemetry = {
        doNotTrack: switchedOff(captured.DO_NOT_TRACK),
        disabled: switchedOff(captured[CLI_ENV.telemetryDisabled]),
        debug: captured[CLI_ENV.telemetryDebug] === "1",
        url: captured[CLI_ENV.telemetryUrl] || undefined,
      };
      const indexUrl = read(text(CLI_ENV.indexUrl)).pipe(Effect.map((url) => url || undefined));
      const apiUrl = read(text(CLI_ENV.devApiUrl)).pipe(
        Effect.map((value) => {
          if (releaseBuild || !URL.canParse(value)) return defaultApiUrl;
          const url = new URL(value);
          const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
          return loopback &&
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
            ? url.href
            : defaultApiUrl;
        }),
      );
      return {
        get,
        settings,
        paths,
        releaseBuild,
        telemetry,
        noTelemetry,
        setNoTelemetry,
        logging,
        childEnv,
        agent,
        color,
        ci: captured.CI !== undefined,
        indexUrl,
        apiUrl,
        offline,
        setOffline,
      };
    }),
  );
}
export class AppConfig extends Context.Service<
  AppConfig,
  {
    releaseBuild: boolean;
    telemetry: { doNotTrack: boolean; disabled: boolean; debug: boolean; url: string | undefined };
    noTelemetry: Effect.Effect<boolean>;
    setNoTelemetry: (value: boolean) => Effect.Effect<void>;
    indexUrl: Effect.Effect<string | undefined>;
    /** No hosted default yet; a loopback development endpoint is source-only. */
    apiUrl: Effect.Effect<string | undefined>;
    offline: Effect.Effect<boolean>;
    setOffline: (value: boolean) => Effect.Effect<void>;
    get: Effect.Effect<Settings, InvalidConfig>;
    /** Current file settings, without environment defaults; consent is rechecked before sending. */
    settings: Effect.Effect<Settings, InvalidConfig>;
    paths: Effect.Effect<Paths>;
    logging: Effect.Effect<LogSettings>;
    color: Effect.Effect<{ noColor: boolean; forceColor: boolean }>;
    /**
     * The whole environment for a child process, built from the environment this layer captured
     * (including its `PATH`): every captured name except `remove`, then `set` on top.
     */
    childEnv: (remove: readonly string[], set?: Record<string, string>) => Record<string, string>;
    /** The agent this invocation runs under, from `AgentMarkers`; `"none"` when no marker is set. */
    agent: Effect.Effect<DetectedAgent>;
    /** A set CI selects agent output even when the streams are terminals. */
    ci: boolean;
  }
>()("stacks/AppConfig") {
  static layer = (build: Build) => configLayer(undefined, build);
  static memory = (env: Environment = {}, build: Build = SOURCE_BUILD) => configLayer(env, build);
}
