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
 * After proving an intentional brief change, regenerate each
 * key from `bun run dev validate --brief <stack> [--sandbox] --json` at the repo root:
 * parse stdout as JSON and sha256 its `brief` string as UTF-8, with no added newline.
 * Both presets use validate's canonical context, not new's machine-dependent brief.
 */
export const briefDigests: Readonly<Record<string, string>> = {
  "astro-blog:default": "sha256:efab8d11b55a3e2b162db25fcb96706dcb8e93d7949901d3b17447f1c8dcf08a",
  "astro-blog:sandbox": "sha256:b383f683fd57b18e9a8be1143964eb78128a592d6786daf4437b89acb73c245a",
  "go-cli:default": "sha256:3aeb16d3e304068ba2ae241d821caa47d411ce2633bcd3273e49345162616dbc",
  "go-cli:sandbox": "sha256:5ca1586dc2a8bb073f25c8652174bbe1a4ad539fc906484fd44fb73077f548cd",
  "python-react:default": "sha256:5307971bf01f4c824b13fb697294cc80f4fff7474458ac054009daebe5aaa017",
  "python-react:sandbox": "sha256:6af8ff14c09f8b673f6421243844a650660c632dbfe6d820398c99853f4922c0",
};
