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
 * all six on 2026-10-31.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:63e50304f588b3498abc7170cd38e73c44278c86b773d6a987023c8828c17a96",
  "astro-blog:sandbox": "sha256:22f22e455147563fe449bae4760f17e54fc5252b8ad7e9d07c22fcb9c2662cdb",
  "go-cli:default": "sha256:282be58e852d2539436c429636d6f3f7e761ba4eb61d6e052077c260a9f647fe",
  "go-cli:sandbox": "sha256:239d28b5e8bd4e9d1531f0a0bcfa0c957831bf44a88e208189db09b3bbf0314b",
  "python-react:default": "sha256:c6dfa367fff709844bc085dc63b46b366d53bdc5ed2e697d4a573427f9ba377f",
  "python-react:sandbox": "sha256:ceaa6507ac99498fa3efacb17622264cb520f661bdbad85e5d48b5e2deb5a3e1",
};
