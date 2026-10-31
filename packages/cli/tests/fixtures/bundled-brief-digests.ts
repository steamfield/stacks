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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:43d6cfe011cc36271c904fb76fe6bb140453199b00308a8fbcd3762ab6fc76b3",
  "astro-blog:sandbox": "sha256:ff6b070b0699468566e4fcc204056937f8f8b06e27ae4d4a2cd301fba1cd25d2",
  "go-cli:default": "sha256:409ba8d13b314025615c9d1a695963e8dfb913fe496a204eefd7b2d4c0447d62",
  "go-cli:sandbox": "sha256:95cc2b2f94070c6fc2228941697e9ed145e785372647b1237db8059657da91d9",
  "python-react:default": "sha256:922cfafa28c52ddb3ac7b36923e91744cd9a33bcd7326d9317056cf2852f469b",
  "python-react:sandbox": "sha256:68cf9e52f3547f4110dc77d98a4c671b16fd76b0b77768f0e8183645c289ec0f",
};
