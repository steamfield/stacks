# Configuration

stacks works with no configuration. Everything here is optional.

## config.json

Optional configuration is `$XDG_CONFIG_HOME/stacks/config.json`, defaulting to `$HOME/.config/stacks/config.json`. Its closed schema accepts these optional keys and rejects any other. Environment values override file values; blank values count as absent. Configuration is read lazily and cached for one invocation, so `--help`, `--version` and `doctor` still work when the file is broken.

```json
{
  "agents": ["claude", "codex"],
  "always": ["git-hooks"],
  "author": "A. Name",
  "package_scope": "@acme",
  "preset": "sandbox"
}
```

| Key | Meaning |
| --- | --- |
| `dataDir` | Data path; `STACKS_DATA_DIR` overrides it |
| `always` | Fragment ids added to every composition they fit; one that doesn't fit, or doesn't exist, is skipped with a warning. `--without` still removes one |
| `agents` | Agents whose `adapters/<agent>/` files are written: any of `claude`, `codex`, `opencode`, `cursor`. `--agents` overrides it; the default is `["claude"]` |
| `author` | Author name for templates |
| `package_scope` | npm scope for templates, such as `@acme` |
| `preset` | `default`, `sandbox` or `lean` for `new`; `--preset` and `--sandbox` override it |
| `telemetry` | `false` disables anonymous usage collection. Prefer `stacks telemetry disable`, which also removes pending events and identity |

Your own stacks and fragments live beside this file, in `stacks/<id>/` and `fragments/<id>/`.

## Environment variables

| Setting | Meaning |
| --- | --- |
| `STACKS_DATA_DIR` | Data path; defaults to `$XDG_DATA_HOME/stacks` (`$HOME/.local/share/stacks`) |
| `STACKS_STATE_DIR` | Project state records; defaults to `$XDG_STATE_HOME/stacks` (`$HOME/.local/state/stacks`) |
| `STACKS_LOG_FORMAT` | `json` for JSON diagnostics, otherwise plain readable logs |
| `STACKS_LOG_FILE` | Optional JSONL file; the directory is recreated when needed |
| `LOG_LEVEL` | trace/debug/info/warn/error/fatal/none; default and invalid-value fallback warn |
| `STACKS_REGISTRY_DIR` | A directory used as the bundled registry instead of the one shipped with the CLI, relative to the working directory; its entries are untrusted |
| `STACKS_INDEX_URL` | Overrides the remote index URL. Published builds default to `https://stacks.steamfield.io/v1/index.json`. Source builds and local packs leave it unset by default. HTTPS is required except for HTTP on `localhost` or `127.0.0.1`. The CLI skips invalid URLs and URLs containing credentials |
| `STACKS_OFFLINE` | `1` disables remote registry requests; the shared `--offline` flag does the same. Verified cached entries remain available |
| `STACKS_DEV_API_URL` | Source builds only: loopback API base URL for search, using HTTP or HTTPS on `localhost`, `127.0.0.1` or `[::1]`, without credentials, query or fragment. Release builds ignore it and use the hosted API, `https://stacks.steamfield.io` |
| `DO_NOT_TRACK`, `STACKS_TELEMETRY_DISABLED` | Any value except empty, `0` or `false` disables telemetry |
| `STACKS_TELEMETRY_URL` | Optional custom telemetry server URL. Published releases use the official endpoint after a first-run notice; source builds never collect, and local packs have no official endpoint. Run `stacks telemetry disable` to turn collection off; see the [privacy page](https://stacks.steamfield.io/telemetry) |
| `STACKS_TELEMETRY_DEBUG` | `1` prints schema-valid events to stderr instead of queuing or sending; consent still applies |
| `CI` | Any set value, including empty, disables telemetry and selects agent output even at a terminal |
| `NO_COLOR` | Any nonempty value turns off color and the live progress line, so human output carries no ANSI escapes; it wins over `FORCE_COLOR`. JSON and agent output never carry them |
| `FORCE_COLOR` | `1` colors human output on a stderr that isn't a terminal, as long as stdout is one (a piped stdout means agent output); it never colors JSON or agent output |
| `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` | Path roots; an unset `HOME` means the user's home directory. The cache is `$XDG_CACHE_HOME/stacks` (`$HOME/.cache/stacks`) |

`--offline` and `STACKS_OFFLINE=1` also disable search API requests.
`DO_NOT_TRACK` disables search API requests with the same value rules; `STACKS_TELEMETRY_DISABLED`
controls telemetry only. See [Search](search.md) for local ranking and its separate backoff file.

Every command accepts `--no-telemetry` to skip collection for one invocation, retaining pending events. Offline invocations also record and send nothing. See [Telemetry](telemetry.md) for consent precedence, state files, privacy and commands.

## Remote registry cache

`list`, `show`, `new` and `add` can read entries from the remote index. Precedence is project, user, index, then bundled. The CLI checks each bundle against its advertised `sha256:<hex>` digest. A digest matching the bundled copy keeps its bundled identity. Custom URLs supply untrusted entries and skip the index signature check. The effective URL must match the build's official URL and the signature must verify against a compiled-in key for index entries to be trusted.

With neither a default nor an override, the index and remote dependency allowlist are off. `doctor --json` then reports `remoteIndex.url: null` and `isDefaultUrl: false`. When a fetchable index URL is set, the CLI looks for `allowlist.json` in the same URL directory and checks its signature, including for a custom index URL.

The cache under `$XDG_CACHE_HOME/stacks/index/` holds the index envelope (`index.json`), URL, timestamps, outcomes, ETag and request backoff (`state.json`), and verified extracted bundles (`entries/<digest>/`). The CLI skips a cache for another URL and checks cached envelopes and bundles again before use, including offline.

`list` and `show` reuse an index younger than 24 hours. Their index requests have a 1,500 ms deadline. A failed read retries after ten minutes, or 24 hours for a 404. A missing bundle backs off that bundle alone. Cache write failures keep the current invocation usable with temporary extracted files. `new` and `add` revalidate on every invocation that reads the registry, with a 3-second request deadline and no retry backoff for that attempt. See [Architecture](../architecture.md#reading-the-registry-index) for the fallback rules.

Maintainers set `STACKS_PUBLISH=1` when packing the published CLI to compile in the official index and telemetry URLs.

## The development wrapper

`bun run dev` runs the CLI from source. It sets info logging, appends `logs/cli.jsonl` (the info records land there whoever reads the output; on stderr only for a human), copies noninteractive stderr to `logs/cli.log`, and uses `.dev/data` and `.dev/state`. Logs rotate above 5 MiB. It forwards arguments, terminal behavior, signals and the child's exit status. `.env` is optional for source development. The published package is a Node bundle and reads no `.env` file.

`bun run dev` runs in the directory you ran it from (a subdirectory of the repo works), with Bun's `.env` and `bunfig.toml` autoload off there. From outside the repo, Bun hides that directory, so pass it: `INIT_CWD="$PWD" bun run --cwd <repo> dev new <stack> app`.
