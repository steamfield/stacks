/**
 * Gate briefs frozen on 2026-10-27, updated for the `stacks` rename and each release's
 * version (the brief names `npx -y @steamfield/stacks@<version>`), the checkout-local notes rule,
 * and the telemetry notice-relay rule with two shortened ground rules. python-react changed on
 * 2026-10-28 for its home-route-test step and stub-free uv init (proven in R3's bench run).
 * The 0.4.1 version in the brief changed all six digests on 2026-10-29, and the registry
 * metadata pass (fragment names and descriptions in the brief) changed them again that day;
 * those briefs await a bench run.
 * These digests changed on 2026-10-29 for the stack audit fixes and await a bench run.
 * The 0.5.0 version in the brief changed all six again on 2026-10-29.
 * The 0.6.0 version in the brief changed all six again on 2026-10-30.
 * The shipped-files ground rule (update stale shipped files, never pin older versions) changed
 * all six on 2026-10-31, and go-cli changed again that day for its shipped proving slice.
 * astro-blog changed again that day for its shipped blog, config and tests.
 * python-react changed that day for its shipped backend and frontend proving slice.
 * python-react changed again that day for Biome frontend linting and formatting.
 * All six changed on 2026-10-31 because previews now say tools' PATH was not checked.
 * All six changed again that day for the brief's project slug and env prefix line and the
 * bundled fragment audit's fragment and stack edits; they await a bench run.
 * All six changed on 2026-11-01 when the stack expansion merged agent-ops' one unconditional
 * allow-rules sentence over the audit; they await a bench run.
 * The 0.7.0 version in the brief changed all six again on 2026-11-01.
 * astro-blog and python-react changed that day when posthog's Testing line named
 * astro-product-site; they await a bench run.
 * All six changed on 2026-11-05 when agent-ops corrected why CLAUDE.md imports AGENTS.md; they
 * await a bench run.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:1fe2dc13bf7036f4c84284037b97ff0169ab8f0e53a31baf177920fb12ac8e6b",
  "astro-blog:sandbox": "sha256:74f7857b290f83c17f963ded79ef0998fa76c33c986603efebdbba3cbbb76802",
  "go-cli:default": "sha256:57e899dda96f5394f829c17541b118e8aa0ee50e0066811db1e658a99b6b9475",
  "go-cli:sandbox": "sha256:22d1543533cf64e19e5454f6439b90c9b2bd1362c3c2d89caa7cc1308c100cf4",
  "python-react:default": "sha256:5d3471015a88e4e28612228cdc35ce8b5c2994526c5fa5009d83dee2af0196c5",
  "python-react:sandbox": "sha256:4cc16a41f6e65e2a1353954c003f8d7332d906d0f41651ac4132df045724f11b",
};
