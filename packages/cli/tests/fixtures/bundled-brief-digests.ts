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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:cf266e3b707727f00fd7621d4abbc7da6cf2123bb431bedaa33efee3f0ddd348",
  "astro-blog:sandbox": "sha256:8e67662247fa7431ed996121fbc4d1f50d2e8dfc89a058f228f04d1948190a0f",
  "go-cli:default": "sha256:7e05a667ffbda97d054df2a0677bbdbea73c14dcd0f3ce2e0904d812ea5f130b",
  "go-cli:sandbox": "sha256:8c5eba976c95a41aa280dd8800bb54fd280ba7293775583796ca81caab97bc80",
  "python-react:default": "sha256:46f4b3995f862487cd064dee828af46f9d4a793f6321a6da7f7f894dde0ba7c9",
  "python-react:sandbox": "sha256:5b7d43e43544d699466d6b5b1cb7d3180a227df9000f1f53ccb0b358bd9e3082",
};
