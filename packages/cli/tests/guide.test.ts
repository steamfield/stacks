import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import { cli } from "../src/cli";
import { countWords } from "../src/core/brief/words";
import { AUTHOR_TOPICS, guideCommands } from "../src/core/guide";
import { splitFrontmatter } from "../src/core/registry/entry";
import { GuideAuthorResult, GuideResult } from "../src/schemas/guide";
import { runCli } from "./helpers/cli";

const decode = (stdout: string) => Schema.decodeUnknownSync(GuideResult)(JSON.parse(stdout));
const FOOTER =
  'Start here (agents): stacks search "<their words>" --json, then stacks show <id> --json.\nExplain your pick and one tradeoff, then stacks new <stack> <dir> --sandbox --json.\nFollow .stacks/BRIEF.md; run stacks verify, then stacks verify --all before calling it done.\nBrowse or recover with stacks list --json. Run stacks guide for the full guide.';

test("stacks with no arguments prints the agent guide, under 250 words, with the trust and VerifyChanged rules [1.4#11]", async () => {
  const { status, stdout, stderr } = await runCli([]);
  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(stdout.startsWith("stacks starts projects for coding agents.")).toBe(true);
  expect(countWords(stdout)).toBeLessThan(250);
  expect(stdout).toContain(
    "- Never pick an entry list --json marks untrusted unless the user named it.\n",
  );
  expect(stdout).toContain(
    "- If verify reports VerifyChanged, stop and ask the user: only they can accept the change.\n",
  );
  expect(stdout).toContain("stacks new <stack> <dir> --sandbox --json");
  expect(stdout).toContain("prefer the higher `stats.greenRateLower` and say why");
  expect(stdout).toContain(
    "If noStrongMatch, say nothing fits well; run stacks list --json and offer the closest entries.",
  );
  expect(stdout).toContain(
    "`stats` are aggregate outcomes across all projects using that stack over the window shown, not a promise for this project.",
  );
  expect(stdout).toContain("if neither has stats, prefer the more recent `lastRun`.");
  expect(stdout).not.toContain("SUBCOMMANDS");
});

test("--help still shows the framework help [1.4#11]", async () => {
  const { status, stdout, stderr } = await runCli(["--help"]);
  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(stdout).toContain("SUBCOMMANDS");
  expect(stdout).toContain("GLOBAL FLAGS");
});

test("stacks --json with no subcommand returns the guide and its commands [1.4#11]", async () => {
  const { status, stdout, stderr } = await runCli(["--json"]);
  expect(stderr).toBe("");
  expect(status).toBe(0);
  const result = decode(stdout);
  expect(result.guide.startsWith("stacks starts projects")).toBe(true);
  expect(result.commands.map((command) => command.name)).toEqual([
    "search",
    "show",
    "new",
    "verify",
    "list",
    "add",
    "validate",
    "guide",
  ]);
});

test("guide prints exactly the bare root's text, in both modes, and is listed in --help [1.4#12]", async () => {
  const bare = await runCli([]);
  const guide = await runCli(["guide"]);
  expect(guide.status).toBe(0);
  expect(guide.stderr).toBe("");
  expect(guide.stdout).toBe(bare.stdout);
  const bareJson = await runCli(["--json"]);
  const guideJson = await runCli(["guide", "--json"]);
  expect(guideJson.status).toBe(0);
  expect(decode(guideJson.stdout)).toEqual(decode(bareJson.stdout));
  expect((await runCli(["--help"])).stdout).toMatch(/\n {2}guide {2,}Print the guide/);
});

test("every command the guide lists is a real subcommand [1.4#12]", () => {
  const names = cli.subcommands.flatMap((group) => group.commands).map((command) => command.name);
  for (const { name } of guideCommands("stacks")) expect(names).toContain(name);
});

test("the root --help ends with the Start here footer; a subcommand's help doesn't [1.4#13]", async () => {
  const root = await runCli(["--help"], { host: { invocation: "npx -y stacks@1.2.3" } });
  expect(root.status).toBe(0);
  expect(root.stdout).toContain(
    '\n\nStart here (agents): npx -y stacks@1.2.3 search "<their words>" --json,',
  );
  expect(root.stdout.trimEnd()).toMatch(/Run npx -y stacks@1\.2\.3 guide for the full guide\.$/);
  const plain = await runCli(["--help"]);
  expect(plain.stdout.trimEnd().endsWith(FOOTER)).toBe(true);
  const json = await runCli(["--help", "--json"]);
  expect((JSON.parse(json.stdout) as { help: string }).help.endsWith(FOOTER)).toBe(true);
  const sub = await runCli(["new", "--help"]);
  expect(sub.status).toBe(0);
  expect(sub.stdout).toContain("--no-launch");
  expect(sub.stdout).not.toContain("Start here");
});

test.each(["stacks", "npx -y stacks@1.2.3"])(
  "%s guide, help footer and structured commands teach the same discovery and verification loop",
  async (invocation) => {
    const opts = { host: { invocation } };
    const guide = decode((await runCli(["guide", "--json"], opts)).stdout);
    const help = (await runCli(["--help"], opts)).stdout;
    const footer = help.slice(help.indexOf("Start here (agents):"));
    const commands = guide.commands.map(({ run, purpose }) => `${run} ${purpose}`).join("\n");
    const escaped = invocation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const text of [guide.guide, footer, commands]) {
      const loop = [
        ...text.matchAll(new RegExp(`${escaped} (search|show|new|verify)(?= |[.,;]|$)`, "g")),
      ].map((match) => match[1]);
      expect(loop).toEqual(["search", "show", "new", "verify", "verify"]);
      expect(text).toContain(`${invocation} search "<their words>" --json`);
      expect(text).toContain(`${invocation} verify --all`);
      expect(text).toContain(`${invocation} list --json`);
    }
    expect(footer).toContain("Explain your pick and one tradeoff");
  },
);

describe("guide author", () => {
  const shipped = fileURLToPath(new URL("../skills/", import.meta.url));
  const fixture = fileURLToPath(new URL("./fixtures/skills/", import.meta.url));
  const decodeAuthor = (stdout: string) =>
    Schema.decodeUnknownSync(GuideAuthorResult, { onExcessProperty: "error" })(JSON.parse(stdout));
  const ok = (run: Awaited<ReturnType<typeof runCli>>) => {
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    return run.stdout;
  };

  test("prints the shipped authoring skill without frontmatter, and --json lists every topic", async () => {
    const text = ok(await runCli(["guide", "author"], { host: { skill: shipped } }));
    const skill = splitFrontmatter(readFileSync(join(shipped, "stacks-author/SKILL.md"), "utf8"));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("name: stacks-author");
    expect(text.trim().split("\n")[0]).toBe(skill?.body.trim().split("\n")[0]);
    const json = decodeAuthor(
      ok(await runCli(["guide", "author", "--json"], { host: { skill: shipped } })),
    );
    expect(json.topic).toBeNull();
    expect(json.topics).toEqual([...AUTHOR_TOPICS]);
    expect(`${json.text.replace(/\n$/, "")}\n`).toBe(text);
  });

  test.each([...AUTHOR_TOPICS])(
    "prints the shipped %s reference with no links left to the skill's own files",
    async (topic) => {
      const json = decodeAuthor(
        ok(await runCli(["guide", "author", topic, "--json"], { host: { skill: shipped } })),
      );
      expect(json.topic).toBe(topic);
      expect(json.text.trim().length).toBeGreaterThan(0);
      expect(json.text).not.toMatch(/\]\((?:\.\.?\/)?(?:references\/)?[a-z-]+\.md/);
      expect(json.text).not.toMatch(/references\/[a-z-]+\.md/);
    },
  );

  test("the shipped skill text names no reference file path, only guide author commands", async () => {
    const json = decodeAuthor(
      ok(await runCli(["guide", "author", "--json"], { host: { skill: shipped } })),
    );
    expect(json.text).not.toMatch(/references\/[a-z-]+\.md/);
  });

  test("links to the skill's own files become the command that prints them", async () => {
    const host = { skill: fixture, invocation: "npx -y @steamfield/stacks@latest" };
    const cli = host.invocation;
    const skill = decodeAuthor(ok(await runCli(["guide", "author", "--json"], { host })));
    expect(skill.text).toBe(
      [
        "# Fixture authoring skill",
        "",
        `Read \`${cli} guide author anatomy\` first. For an existing repo, read the repo route (\`${cli} guide author from-repo\`).`,
        `Bare mention: ${cli} guide author submit. Unknown link stays: [notes](references/notes.md). External: [docs](https://example.com/x.md).`,
        "",
      ].join("\n"),
    );
    const anatomy = decodeAuthor(
      ok(await runCli(["guide", "author", "anatomy", "--json"], { host })),
    );
    expect(anatomy.text).toBe(
      [
        "# Fixture anatomy",
        "",
        `Back to the skill (\`${cli} guide author\`). Next, \`${cli} guide author fragment\` and search cards (\`${cli} guide author search-card\`).`,
        "",
      ].join("\n"),
    );
  });

  test("an unknown topic is a usage error naming the closest topics", async () => {
    const run = await runCli(["guide", "author", "from-rep", "--json"], {
      host: { skill: shipped },
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toMatchObject({
      error: {
        tag: "Usage",
        details: {
          flag: "topic",
          command: "guide author",
          value: "from-rep",
          expected: AUTHOR_TOPICS.join(" | "),
          suggestions: ["from-repo"],
        },
      },
    });
    const text = await runCli(["guide", "author", "from-rep"], { host: { skill: shipped } });
    expect(text.status).toBe(2);
    expect(text.stdout).toBe("");
    expect(text.stderr).toContain("from-repo");
    expect(text.stderr).toContain("Next:");
  });

  test("a missing bundled reference is NotFound with its path", async () => {
    const run = await runCli(["guide", "author", "submit", "--json"], {
      host: { skill: fixture },
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toMatchObject({
      error: {
        tag: "NotFound",
        details: { path: join(fixture, "stacks-author", "references", "submit.md") },
      },
    });
  });

  test("schema guide-author describes the result", async () => {
    const run = await runCli(["schema", "guide-author", "--json"]);
    expect(run.status).toBe(0);
    const schema = Schema.decodeUnknownSync(
      Schema.Struct({ required: Schema.Array(Schema.String) }),
    )(JSON.parse(run.stdout));
    expect(schema.required).toEqual(["topic", "text", "topics"]);
  });
});
