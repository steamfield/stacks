/**
 * Owns environment and settings reads. Settings are lazy so a broken `config.json` leaves
 * diagnostics and version output available.
 */
import { homedir } from "node:os";
import { AgentId, type DetectedAgent } from "@steamfield/stacks-format";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { type Build, SOURCE_BUILD } from "./build";
import {
  CONFIG_FILENAME,
  DEFAULT_CACHE_HOME,
  DEFAULT_CONFIG_HOME,
  DEFAULT_DATA_HOME,
  DEFAULT_LOG_FILE,
  DEFAULT_LOG_FORMAT,
  DEFAULT_LOG_LEVEL,
  DEFAULT_STATE_HOME,
  SLUG,
  TELEMETRY_DIRNAME,
} from "./constants";
import { defined } from "./core/object";
import { AgentMarkers, CLI_ENV } from "./env-names";
import { InvalidConfig } from "./errors";
import { Settings } from "./schemas/config";
export type Environment = Record<string, string | undefined>;
export type Paths = {
  /** `HOME`, then the OS home directory. */
  home: string;
  /** `config.json` under `user`. */
  config: string;
  /** `STACKS_DATA_DIR`, then `stacks` under `XDG_DATA_HOME` or `home/.local/share`. */
  data: string;
  /** `stacks` under `XDG_CACHE_HOME`, falling back to `home/.cache`. */
  cache: string;
  /** `STACKS_STATE_DIR`, then `stacks` under `XDG_STATE_HOME` or `home/.local/state`. */
  state: string;
  /** The `telemetry` directory under `state`. */
  telemetry: string;
  /** `stacks` under `XDG_CONFIG_HOME`, falling back to `home/.config`. */
  user: string;
  /**
   * `STACKS_REGISTRY_DIR` as given, or absent to use `Host.registry`.
   * `bundledRoot` resolves it against `Host.cwd`.
   */
  registry?: string;
};
export type LogSettings = {
  level: "Trace" | "Debug" | "Info" | "Warn" | "Error" | "Fatal" | "None";
  format: "human" | "json";
  file: string;
  noColor: boolean;
};
const envFrom = (captured: Environment) => (key: string) =>
  Object.hasOwn(captured, key) ? captured[key] || undefined : undefined;

/** Reads markers in priority order for the audience and person-only gates (trust point 4). */
export function detectAgent(captured: Environment): DetectedAgent {
  const env = envFrom(captured);
  for (const item of AgentMarkers) {
    const value = env(item.name);
    if (value === undefined) continue;
    if (item.equals !== undefined && value !== item.equals) continue;
    if (item.agent !== "by-value") return item.agent;
    const named = value.toLowerCase();
    return AgentId.literals.find((id) => named.startsWith(id)) ?? "other";
  }
  return "none";
}
const LOG_LEVELS: Readonly<Record<string, LogSettings["level"]>> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
  none: "None",
};
/** A case-insensitive `LOG_LEVEL` value, with `DEFAULT_LOG_LEVEL` for missing or unknown values. */
function logLevel(value: string | undefined): LogSettings["level"] {
  if (value === undefined) return DEFAULT_LOG_LEVEL;
  const name = value.toLowerCase();
  // Own keys only: `constructor` or `__proto__` would otherwise read Object.prototype.
  return (Object.hasOwn(LOG_LEVELS, name) ? LOG_LEVELS[name] : undefined) ?? DEFAULT_LOG_LEVEL;
}

/** An opt-out variable is on when set to anything but blank, `0` or `false`. */
const switchedOff = (value: string | undefined) =>
  value !== undefined && value !== "0" && value !== "false";

/**
 * The hosted API URL: `STACKS_DEV_API_URL` when it is a plain http(s) loopback URL in a source
 * build (no credentials, query or fragment), else the build's default.
 */
function apiUrlFor(value: string, build: Build): string | undefined {
  const { releaseBuild, officialApiUrl } = build;
  if (releaseBuild || !URL.canParse(value)) return officialApiUrl;
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  return loopback &&
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url.href
    : officialApiUrl;
}

/** A child's whole environment: what was captured, minus `remove`, plus `set`. */
const childEnvFrom =
  (captured: Environment) =>
  (remove: readonly string[], set: Record<string, string> = {}) => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(captured))
      if (value !== undefined && !remove.includes(key)) env[key] = value;
    return { ...env, ...set };
  };

function configLayer(environment: Environment | undefined, build: Build) {
  // Copied when the layer is created, so later changes to the live environment aren't seen.
  const captured = { ...(environment ?? process.env) };
  const env = envFrom(captured);
  return Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const paths = Effect.sync((): Paths => {
        const home = env("HOME") ?? homedir();
        const user = path.join(
          env("XDG_CONFIG_HOME") ?? path.join(home, DEFAULT_CONFIG_HOME),
          SLUG,
        );
        const config = path.join(user, CONFIG_FILENAME);
        const data =
          env(CLI_ENV.dataDir) ??
          path.join(env("XDG_DATA_HOME") ?? path.join(home, DEFAULT_DATA_HOME), SLUG);
        const cache = path.join(env("XDG_CACHE_HOME") ?? path.join(home, DEFAULT_CACHE_HOME), SLUG);
        const state =
          env(CLI_ENV.stateDir) ??
          path.join(env("XDG_STATE_HOME") ?? path.join(home, DEFAULT_STATE_HOME), SLUG);
        const telemetry = path.join(state, TELEMETRY_DIRNAME);
        const registry = env(CLI_ENV.registryDir);
        return defined({
          config,
          home,
          data,
          cache,
          state,
          telemetry,
          user,
          registry,
        });
      });
      // A missing file is no settings; any read, parse or decode failure is InvalidConfig.
      const readSettingsFile = Effect.gen(function* () {
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
      const settings = yield* Effect.cached(
        Effect.gen(function* () {
          const locations = yield* paths;
          const file = yield* readSettingsFile;
          const override = env(CLI_ENV.dataDir);
          return { ...file, dataDir: override || file.dataDir || locations.data };
        }).pipe(Effect.mapError(() => new InvalidConfig())),
      );
      const noColor = env("NO_COLOR") !== undefined;
      const logging = Effect.sync(
        (): LogSettings => ({
          level: logLevel(env(CLI_ENV.logLevel)),
          format: env(CLI_ENV.logFormat) === "json" ? "json" : DEFAULT_LOG_FORMAT,
          file: env(CLI_ENV.logFile) ?? DEFAULT_LOG_FILE,
          noColor,
        }),
      );
      const indexUrl = env(CLI_ENV.indexUrl);
      // `--offline` and `--no-telemetry` set these per invocation, on top of the environment.
      let offlineFlag = false;
      let telemetryFlag = false;
      return {
        settings,
        readSettingsFile,
        paths,
        releaseBuild: build.releaseBuild,
        telemetry: {
          doNotTrack: switchedOff(env("DO_NOT_TRACK")),
          disabled: switchedOff(env(CLI_ENV.telemetryDisabled)),
          debug: env(CLI_ENV.telemetryDebug) === "1",
        },
        telemetryUrl: env(CLI_ENV.telemetryUrl) ?? build.officialTelemetryUrl,
        noTelemetry: Effect.sync(() => telemetryFlag),
        setNoTelemetry: (value: boolean) =>
          Effect.sync(() => {
            telemetryFlag = value;
          }),
        logging,
        // Children receive captured blank values unchanged.
        childEnv: childEnvFrom(captured),
        agent: Effect.sync(() => detectAgent(captured)),
        color: Effect.succeed({
          noColor,
          forceColor: env("FORCE_COLOR") === "1",
        }),
        // CI is a presence check, including when it is set to an empty string.
        ci: captured.CI !== undefined,
        indexUrl: Effect.succeed(indexUrl),
        officialIndexUrl: build.officialIndexUrl,
        remoteIndexUrl: Effect.succeed(indexUrl ?? build.officialIndexUrl),
        apiUrl: Effect.sync(() => apiUrlFor(env(CLI_ENV.devApiUrl) ?? "", build)),
        offline: Effect.sync(() => offlineFlag || env(CLI_ENV.offline) === "1"),
        setOffline: (value: boolean) =>
          Effect.sync(() => {
            offlineFlag = value;
          }),
      };
    }),
  );
}
/**
 * `settings` applies invocation defaults and caches the result. `readSettingsFile` decodes the
 * current file without defaults so telemetry can recheck consent and `saveSetting` can write it.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    releaseBuild: boolean;
    telemetry: { doNotTrack: boolean; disabled: boolean; debug: boolean };
    telemetryUrl: string | undefined;
    noTelemetry: Effect.Effect<boolean>;
    setNoTelemetry: (value: boolean) => Effect.Effect<void>;
    /** The configured override, which disables hosted stats even if it matches the official URL. */
    indexUrl: Effect.Effect<string | undefined>;
    officialIndexUrl: string | undefined;
    remoteIndexUrl: Effect.Effect<string | undefined>;
    /** The hosted API: the build's default, or a loopback development endpoint in a source build. */
    apiUrl: Effect.Effect<string | undefined>;
    offline: Effect.Effect<boolean>;
    setOffline: (value: boolean) => Effect.Effect<void>;
    settings: Effect.Effect<Settings, InvalidConfig>;
    readSettingsFile: Effect.Effect<Settings, InvalidConfig>;
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
