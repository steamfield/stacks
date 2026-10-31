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
 * python-react changed that day for its shipped backend and frontend proving slice.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:459773df1d3b4b4fbf951d1a31b3ca8c974753d0636a0bda75d142b5a4e2bfde",
  "astro-blog:sandbox": "sha256:58f88f68bf14a87d63f92b8d36a7fc7cd14abcd119232d8ced1534f504e29dd4",
  "go-cli:default": "sha256:409ba8d13b314025615c9d1a695963e8dfb913fe496a204eefd7b2d4c0447d62",
  "go-cli:sandbox": "sha256:95cc2b2f94070c6fc2228941697e9ed145e785372647b1237db8059657da91d9",
  "python-react:default": "sha256:4b95c528537656c103455114b76de21cabbb15f33f5cf6d1eb207b0fc0ace2cf",
  "python-react:sandbox": "sha256:97027b6e5ba20c8896ca826d11949c8d0b4425871e7ff6e870e1c1b748f2e63d",
};
