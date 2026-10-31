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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:a1b9f703bafc18e2662ce904a83b26367d9e094f19f4ebb27200118fa5046a89",
  "astro-blog:sandbox": "sha256:6fc0aaec257186b899e8684dc69afa087b48cb8b5deea1bf3899f4f36c946a75",
  "go-cli:default": "sha256:2b6457bc44e5eb9bb84a9642e99c061414eda8af282a4a00802a0784045dcb6c",
  "go-cli:sandbox": "sha256:ab37d8c15211e2fcf4b7ff753f6e75b04f066efcbc569de57548c890add3256c",
  "python-react:default": "sha256:513a93e3fc5acc511418a5da5f343f3c4b5baaa8729bb610715f8cfbd98708a5",
  "python-react:sandbox": "sha256:783a76595535f243969a092deb01f73d295f4713aa1b36c3741f34a8042fdb23",
};
