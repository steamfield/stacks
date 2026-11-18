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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:86601ab0d397e01d6e520a598f8e15eacecca9aef4ebef8f9f52c6c7d2a77398",
  "astro-blog:sandbox": "sha256:5269bc807db7b9730fce06969eaf4c2f42eba42133f2cb87878bd41a9d550c1f",
  "go-cli:default": "sha256:22cd22095f8f6bed17e090418d6db10f06f97d810a3ab88df2eacfb308cd7f37",
  "go-cli:sandbox": "sha256:512ca98d1ce43a7debada6a38962cc23af0f7f170455c88e7204f9dc6c1a7742",
  "python-react:default": "sha256:eda3ab2865a3a9612c4a23dfe51e3cb5b75e21e494b52aa2efbc80ed818d668d",
  "python-react:sandbox": "sha256:418a12b57374684535c0c454023a9f017bf1b0af1dbeee11697a02abb76d0602",
};
