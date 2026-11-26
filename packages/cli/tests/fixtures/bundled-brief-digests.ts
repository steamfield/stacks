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
 * All six changed on 2026-11-26 for the stack audit's phase 1 (the core fragments' DX baseline
 * and python-api's dev-bg, audit and ci targets); they await a bench run. All six changed again
 * that day for the phase 1 boundary fixes (audit as its own CI step, dev-status, shared dev-bg).
 * go-cli changed again that day when its ci command stopped running vuln; it awaits a bench run.
 * astro-blog changed that day for its ci, audit and dev-bg commands, and python-react for
 * react-vite's audit command; both await a bench run.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:e8e1c77c35bc194939b5943f9901c9cd95fb05e985d48c0738c974e3d6415a91",
  "astro-blog:sandbox": "sha256:412b981ec11cf1a1d6d67e8220083d7b643e5b76a00e8c464a767cf703d8d094",
  "go-cli:default": "sha256:37845700f47e2c38a4c50d7d7fff7770cf55e2c4c8f4cef61fca100e147d931f",
  "go-cli:sandbox": "sha256:60c06a99ad834bdc9f53e66a9b0fc504aeb0fbf5cba8a4fbd10fafafc6f9fd13",
  "python-react:default": "sha256:93c44843ec60992fa0ec88d29f232a8e634ee304afeee25de421230702de99a2",
  "python-react:sandbox": "sha256:29fadcdf3042b0aa4ef644d6fa323e4cf8f2da64b322f8dbff8a28100edfc01f",
};
