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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:f915c70106c63123ec3b2e988a49fdbbbbb9ee21b0e98dadc0920ebf2b79244d",
  "astro-blog:sandbox": "sha256:c0edfb1c03b570aa2f28019a68e7999138b0e70c2e2ed5264126feb18e3c5391",
  "go-cli:default": "sha256:c7d143fd39cc5cbbd43e283b1350caf1d8143ae49f813de1e2b06f6bbf533db4",
  "go-cli:sandbox": "sha256:1fda1e116fff1f38b6621d31c80de2392f9bb28db99795e900000fa92503e736",
  "python-react:default": "sha256:41aab6153d1caa65faec35106db3de3256f9e6bc13d370623e85dde11533f62b",
  "python-react:sandbox": "sha256:170579942ccaccdb1185a98c4f2eb5da17a3ad1b097d64c17129b25f2b4dab85",
};
