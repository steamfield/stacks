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
  "astro-blog:default": "sha256:13325938254e64bd094c6bd25d998b00c1792535d954b3c07030da40d6a81706",
  "astro-blog:sandbox": "sha256:62cc98b852d14a05f25e0c3b7557c07c14cdea54ad3de6c0027084102fd7c92d",
  "go-cli:default": "sha256:daa78b445c5972daab182e0ad9cbbfffb43f2d3db617a4c415453ce77455f2e9",
  "go-cli:sandbox": "sha256:a95e731ed9a1508332d8dde85a1c13952b85a32db14753d2093bd7b4f72c6527",
  "python-react:default": "sha256:59cd421a212a4cca744ed3f38c54215a4c395bb75b0ae65c7a3cf26f58392c07",
  "python-react:sandbox": "sha256:c886ed5c2c5f5c18246394d874f551a9beeca4b4c34905a36f796424a1bcead3",
};
