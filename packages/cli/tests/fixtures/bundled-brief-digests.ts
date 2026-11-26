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
 * and python-api's dev-bg, audit and ci targets); they await a bench run.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:fab1802f354569e8cc19daccad509645df92a30702c18cdd7d95960ae46b6b00",
  "astro-blog:sandbox": "sha256:86b88648f170a9521718a8a22203f63047398578998acf2d52f6a7d22eaeef4a",
  "go-cli:default": "sha256:7c45e9813c6c4712a144062807414fe189d4daae57f000f38ba092869a76ee14",
  "go-cli:sandbox": "sha256:125c585bc48056082b91e35cda86efdf1a486b071f7ed219e4751a097280055d",
  "python-react:default": "sha256:9b913688d3679461e65acb0111eb707b94e4f48f4a6d43d459fac74632f6061f",
  "python-react:sandbox": "sha256:956fb80882988a37d54cc8bb03f9c94f446499e5b6848176a1af42d92fd3922e",
};
