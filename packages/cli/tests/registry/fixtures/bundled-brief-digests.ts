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
 * The 0.8.0 version in the brief changed all six again on 2026-11-14.
 * All six changed again that day for the Start here action list (install commands, code-layer
 * verify, verify --all as done), the hygiene steps and the claude-harness-docs split; they
 * await a bench run.
 * The 0.9.0 version in the brief changed all six again on 2026-11-14.
 * All six changed on 2026-11-15 when agent-ops corrected why CLAUDE.md imports AGENTS.md; they
 * await a bench run.
 * The 0.10.0 version in the brief changed all six again on 2026-11-15.
 * The 0.11.0 version in the brief changed all six again on 2026-11-15.
 * All six changed again that day when agent-ops stated the destructive-only hook policy and
 * pointed agents at the shipped engineering guidance; they await a bench run.
 * The 0.12.0 version in the brief changed all six again on 2026-11-15.
 * The 0.13.0 version in the brief changed all six again on 2026-11-16.
 * All six changed on 2026-11-16 for After green's review step, and Start here's pointer to it.
 * The 0.14.0 version in the brief changed all six again on 2026-11-16.
 * The 0.14.1 version in the brief changed all six again on 2026-11-16.
 * python-react changed on 2026-11-18 for its pre-optimized Vite deps, the posthog-free lean
 * scaffold, `isbot` as a declared dependency and the adding-a-resource guidance (each proven
 * on fresh lean and default scaffolds); it awaits a bench run.
 * python-react changed again on 2026-11-18 when it became a workspace of python-api and
 * react-vite (proven on fresh default and lean scaffolds), and astro-blog changed that day when
 * posthog's Testing line dropped python-react; both await a bench run. python-react changed
 * once more that day when its part lines named README, env, AGENTS and CLAUDE files by where
 * they are written and git-hooks returned to its default tier; it awaits a bench run.
 * The 0.15.0 version in the brief changed all six again on 2026-11-18.
 * All six changed on 2026-11-26 when the brief's file list began naming .stacks/sources.json,
 * and again that day when ci-github named macOS runners for Xcode jobs; they await a bench run.
 * The 0.17.0 version in the brief changed all six again on 2026-11-27.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:239a2b91a6aa1535f421277faa46e573cd1a92f9b1836fdce7973b5c5326d354",
  "astro-blog:sandbox": "sha256:cfe068db4cc4d7bca9eeb560758671ae32c53e85a3fb778d8cb4f3607c8bc90d",
  "go-cli:default": "sha256:078b4050e2cf4154cf58128747c00ad265b6ddc321c09e365ff76fd25345be58",
  "go-cli:sandbox": "sha256:556bf5a6bf06b220a0e5b92ef74ca99003ec2163f51d3ba03ceb2bcc4bd1a8cd",
  "python-react:default": "sha256:f52534cdc4bc0d49e263351fbd2979ca58b28c867ad2884bf0bc7d5110ab91a1",
  "python-react:sandbox": "sha256:bd178e6caf0959b85a93acdc7f91afc81b96fba5e5748476b10d09e17a136f06",
};
