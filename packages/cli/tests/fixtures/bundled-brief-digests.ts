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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:ebe06bb06f2f08f3fe23d141199dac4b6660e978ff8c6b9324e61e657fff3878",
  "astro-blog:sandbox": "sha256:1000a55545c7b857c549d16ddb498fa02f2d91d1566a9d018b1c893cbda78447",
  "go-cli:default": "sha256:34a0591cc0076062919c2f065596f54f9fc62cac09c19df96283dab0bdcfa91a",
  "go-cli:sandbox": "sha256:234e0d4e2468c5fa381ffe340021c1cc4744419bb040837d6ddbbf1afefabbbd",
  "python-react:default": "sha256:d8a33060bc592d0d00e6c7512726594ffe33ea69ee90994656dbce98aa334ba8",
  "python-react:sandbox": "sha256:84e253e74da983a7ffc2153c2bef7f25cab143f96986db5d54bfa5a25a95a2b8",
};
