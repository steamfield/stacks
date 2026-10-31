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
 * All six changed again that day when agent-ops replaced its per-stack allow-rules branch
 * with one unconditional sentence; they await a bench run.
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:2306c7c63518b609705252d040dbea798afd5416c8ac215f098619a28734e077",
  "astro-blog:sandbox": "sha256:e87c80abfaafbad1682f84484bd8798e6c7cd8742a03992051f702c2b51d21f7",
  "go-cli:default": "sha256:acd0493b1da6b4d73b617db3e1dede7591dc78b4cbb6a78396fd7b9fc9bd1868",
  "go-cli:sandbox": "sha256:0ff5757ceee647b3ed42d22ab084ce4b8fe1ef696e0bee949568ea299a5827ef",
  "python-react:default": "sha256:69b9dcd261054fa6cea23a190448f8b50ac84644c995005e33363c0f2effb16f",
  "python-react:sandbox": "sha256:212b470c1cd2bce2ecfc96548c77c2f4900222899dce885724078af5c0f41de4",
};
