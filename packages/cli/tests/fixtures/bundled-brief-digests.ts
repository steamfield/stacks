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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:633ca4c32e466e37a50787da84c02821ab3fc8de0781fe71eba2d3b89e51d0c5",
  "astro-blog:sandbox": "sha256:c6018df84342b43596a257234760223519b0634a6813ebcbce05b77fb191a767",
  "go-cli:default": "sha256:9088bff3e0d705e5469a106608c5cd5791e26de083e0ab33fe5ffb8edb403174",
  "go-cli:sandbox": "sha256:3ee14c38ead6d92ca5082b868e9d74f5cfae5004ed7020aa9a43119b83605c7c",
  "python-react:default": "sha256:2a8c9a6ba659aadaa0387e24798acc4a094e67020bdb61fb3821ebb12b3f2e94",
  "python-react:sandbox": "sha256:29b875c170355a8c0c9989f11accf9f93e2c2f2a35380cdfacdc13c4cfaf8f87",
};
