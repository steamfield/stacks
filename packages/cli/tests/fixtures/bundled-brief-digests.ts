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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:0fce841a958c2b3907cf13c0441cca42cd9078602e8374f902b3e2acde64f1a7",
  "astro-blog:sandbox": "sha256:f13fc46d3fe9e78075bcdad64cfc7aa999bc8cebeb9043a9508d136b1ba8ae1e",
  "go-cli:default": "sha256:bc8488e8a1cae79e8d225d636047e9aa8f82bd47603e61d15ca82ea8614a405b",
  "go-cli:sandbox": "sha256:6b7fe055493416c191b69ab9d5638777fb8b280671b46e268756345d4aba4ea6",
  "python-react:default": "sha256:7e140e294130489f7ed62fa757fc5de57df2860dc9edd9c1465e2d420015630e",
  "python-react:sandbox": "sha256:b4824ca38494c0fb4819d563a7fc23caf5649be53007544e458acd89ebb024f0",
};
