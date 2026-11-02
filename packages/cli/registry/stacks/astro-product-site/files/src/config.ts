// Public product metadata. Every landing section reads from here; a section whose
// value is empty (null or an empty list) doesn't render.

export type Link = { label: string; href: string };
export type InstallOption = { label: string; command: string };
export type Feature = { title: string; body: string };
export type Logo = { name: string; href: string; logo: string };
export type DemoLine = { prompt?: boolean; text: string };

const repo = "https://github.com/example/acme";

export const site = {
  name: "Acme",
  tagline: "Turn a folder of notes into a searchable knowledge base.",
  description: "Acme indexes Markdown notes and answers questions about them from the terminal.",
  /** Absolute production URL: canonicals, the sitemap, OG images and llms.txt use it. */
  url: "https://example.com",
  repo,
  /** Current release, shown in the header. Empty hides it. */
  version: "0.1.0",
  announcement: {
    label: "Acme 0.1 is out: read the release notes",
    href: `${repo}/releases`,
  } as Link | null,
  install: [
    { label: "npm", command: "npm install -g acme" },
    { label: "bun", command: "bun add -g acme" },
    { label: "Homebrew", command: "brew install acme" },
  ] as InstallOption[],
  demo: {
    title: "Indexing a notes folder",
    lines: [
      { prompt: true, text: "acme index ~/notes" },
      { text: "Indexed 412 notes in 1.8s" },
      { prompt: true, text: 'acme ask "where did we decide on the cache size?"' },
      { text: "decisions/2026-03-cache.md: 64 MB per worker, set in config.toml" },
    ] as DemoLine[],
  },
  features: [
    {
      title: "Local first",
      body: "The index lives next to your notes. Nothing leaves your machine.",
    },
    { title: "Plain files", body: "Acme reads Markdown as it is. No import step and no lock-in." },
    { title: "Fast answers", body: "Questions return in under a second on a laptop." },
  ] as Feature[],
  usedBy: [] as Logo[],
  sponsors: { href: `${repo}/sponsors`, logos: [] as Logo[] },
  social: [{ label: "GitHub", href: repo }] as Link[],
  releasesUrl: `${repo}/releases`,
  license: "MIT",
  /** Components that hydrate on the landing page. The build test fails on any other island. */
  islands: ["InstallTabs"],
};

/** Docs sidebar groups, in order. A page's `group` frontmatter must be one of these ids. */
export const docsGroups = [
  { id: "getting-started", label: "Getting started" },
  { id: "concepts", label: "Concepts" },
  { id: "guides", label: "Guides" },
  { id: "reference", label: "Reference" },
] as const;

export type DocsGroupId = (typeof docsGroups)[number]["id"];

if (!["https:", "http:"].includes(new URL(site.url).protocol)) {
  throw new Error("Set site.url to an absolute HTTP or HTTPS production URL.");
}
