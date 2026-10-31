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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:d9273a87707aeeba67cbdf3d18d96f4cbe199ecaf4a9e6b52934edc5384ff42b",
  "astro-blog:sandbox": "sha256:d9e1dc3515cb1471953c464f0949c990078fe46bbb039a8f65bb5cae8edb8cff",
  "go-cli:default": "sha256:a1540239ff24b7e5fb0a1033a023d1c31519d75aa8a2d015aecea3e357cf7fdd",
  "go-cli:sandbox": "sha256:b4d7e455f0b4ff18421a4ae084cacfba9d6cfa93613320377e3abde83ae529b7",
  "python-react:default": "sha256:049419540a1184da783249b596ce16da5d02288c333b29a8588a82bc6a92fc57",
  "python-react:sandbox": "sha256:3fa3e3f333f1352605065ef86aed74443f9cf2f092254b9e36cd93f093e277bf",
};
