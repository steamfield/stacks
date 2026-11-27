/**
 * Every CLI default: endpoints, logging, directories, and network and cache timing. Each constant's
 * comment names the setting or variable that overrides it, or says none does; a new default goes
 * here with that comment, and `config.ts` applies the overrides.
 */

/** Hosted API base URL. A valid `STACKS_DEV_API_URL` overrides it in source builds. */
export const HOSTED_API_URL = "https://stacks.steamfield.io";
/** Official index URL, unset until a host exists. `STACKS_INDEX_URL` overrides it. */
export const OFFICIAL_INDEX_URL: string | undefined = undefined;
/** Telemetry base URL for packages built with `STACKS_PUBLISH=1`. `STACKS_TELEMETRY_URL` overrides it. */
export const OFFICIAL_TELEMETRY_URL = HOSTED_API_URL;
/** npm registry base URL for `update`. No environment or settings override. */
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";

/** Log level for missing or invalid input. `LOG_LEVEL` overrides it with a recognized level. */
export const DEFAULT_LOG_LEVEL = "Warn";
/** Readable log format. `STACKS_LOG_FORMAT=json` selects JSON. */
export const DEFAULT_LOG_FORMAT = "human";
/** An empty path disables the log file. `STACKS_LOG_FILE` supplies a path. */
export const DEFAULT_LOG_FILE = "";

/** Config directory under `HOME` when `XDG_CONFIG_HOME` is unset. */
export const DEFAULT_CONFIG_HOME = ".config";
/** Data directory under `HOME` when `XDG_DATA_HOME` is unset. `STACKS_DATA_DIR` or `dataDir` can set the data path. */
export const DEFAULT_DATA_HOME = ".local/share";
/** State directory under `HOME` when `XDG_STATE_HOME` is unset. `STACKS_STATE_DIR` can set the state path. */
export const DEFAULT_STATE_HOME = ".local/state";
/** Cache directory under `HOME` when `XDG_CACHE_HOME` is unset. */
export const DEFAULT_CACHE_HOME = ".cache";
/** Subdirectory under XDG roots. `STACKS_DATA_DIR`, `dataDir` and `STACKS_STATE_DIR` bypass it for their paths. */
export const SLUG = "stacks";
/** Settings filename under the config directory. `XDG_CONFIG_HOME` can relocate its parent. */
export const CONFIG_FILENAME = "config.json";
/** Telemetry subdirectory under state. `STACKS_STATE_DIR` or `XDG_STATE_HOME` can relocate its parent. */
export const TELEMETRY_DIRNAME = "telemetry";

const DAY_MS = 24 * 60 * 60 * 1000;

/** At this age, the index, stats and allowlist can refresh. Stale responses remain usable offline or after a failed refresh. No environment or settings override. */
export const CACHE_FRESHNESS_MS = DAY_MS;
/** Fetch deadline for the index, bundles, stats and allowlist. No environment or settings override. */
export const CACHED_FETCH_DEADLINE_MS = 1_500;
/** Deadline for `RemoteIndex.refresh` before `new` and `add`, and for resolving index entries across one invocation's `Registry.all` calls. No environment or settings override. */
export const INDEX_REFRESH_DEADLINE_MS = 3_000;
/** Failure backoff for cached fetches, search and telemetry. A 404 changes it for cached fetches and `Retry-After` can override it for telemetry. */
export const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
/** Backoff after a 404 from the index, bundles, stats or allowlist. No environment or settings override. */
export const NOT_FOUND_BACKOFF_MS = DAY_MS;
/** Hosted search deadline. No environment or settings override. */
export const SEARCH_DEADLINE_MS = 800;
/** Automatic telemetry flush deadline. No environment or settings override. */
export const TELEMETRY_FLUSH_AFTER_COMMAND_MS = 800;
/** Deadline for `stacks telemetry flush`. No environment or settings override. */
export const TELEMETRY_FLUSH_NOW_MS = 5_000;
/** npm registry request timeout. The `registryTimeout` caller option overrides it. */
export const NPM_REGISTRY_TIMEOUT_SECONDS = 10;
/** Global npm install timeout. The `installTimeout` caller option overrides it. */
export const NPM_INSTALL_TIMEOUT_MINUTES = 5;
