import { Effect, FileSystem, Path } from "effect";
import { NotFound, PermissionDenied, Usage } from "../errors";
import { BRIEF_PATH, MANIFEST_PATH } from "../project-layout";
import type { GuideAuthorResult } from "../schemas/guide";
import { Host } from "../services/host";
import { splitFrontmatter } from "./registry/entry";
import { closest } from "./suggest";

/** The authoring skill's reference files, `references/<topic>.md` under `stacks-author/`. */
export const AUTHOR_TOPICS = [
  "anatomy",
  "fragment",
  "from-repo",
  "interview",
  "search-card",
  "submit",
] as const;
type AuthorTopic = (typeof AUTHOR_TOPICS)[number];
const isAuthorTopic = (name: string): name is AuthorTopic =>
  (AUTHOR_TOPICS as ReadonlyArray<string>).includes(name);

/** The topic a link target names (`references/x.md`, `./x.md`, `x.md`), `""` for SKILL.md. */
function linkedTopic(target: string): AuthorTopic | "" | undefined {
  if (/^(?:\.\/|\.\.\/)?SKILL\.md$/.test(target)) return "";
  const topic = /^(?:\.\/|\.\.\/)?(?:references\/)?([a-z-]+)\.md(?:#\S*)?$/.exec(target)?.[1];
  return topic !== undefined && isAuthorTopic(topic) ? topic : undefined;
}

/**
 * The authoring skill's links to its own files, rewritten to the command that prints each one, so
 * an agent reading through `guide author` can follow them without the files. A Markdown link
 * becomes its label and the command (only the command when the label is the file name), and a
 * bare `references/x.md` becomes the command.
 */
export function rewriteAuthorLinks(text: string, cli: string): string {
  const command = (topic: AuthorTopic | "") =>
    topic === "" ? `${cli} guide author` : `${cli} guide author ${topic}`;
  const linked = text.replace(
    /\[([^\]\n]*)\]\(([^)\s]+)\)/g,
    (link, label: string, target: string) => {
      const topic = linkedTopic(target);
      if (topic === undefined) return link;
      const plain = label.replace(/`/g, "").trim();
      return plain === topic || linkedTopic(plain) === topic
        ? `\`${command(topic)}\``
        : `${label} (\`${command(topic)}\`)`;
    },
  );
  return linked.replace(
    /(?<![\w/.-])(?:\.\/)?references\/([a-z-]+)\.md\b/g,
    (mention, topic: string) => (isAuthorTopic(topic) ? command(topic) : mention),
  );
}

/**
 * `guide author [topic]`: the authoring skill's SKILL.md without its frontmatter, or one of its
 * references, read from the bundled skills root with links rewritten. An unknown topic is a
 * Usage error with the closest topics.
 */
export const authorGuide = (topic: string | undefined) =>
  Effect.gen(function* () {
    if (topic !== undefined && !isAuthorTopic(topic))
      return yield* new Usage({
        details: {
          flag: "topic",
          command: "guide author",
          value: topic,
          expected: AUTHOR_TOPICS.join(" | "),
          suggestions: closest(topic, AUTHOR_TOPICS),
        },
      });
    const host = yield* Host;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(host.skill, "stacks-author");
    const file =
      topic === undefined
        ? path.join(dir, "SKILL.md")
        : path.join(dir, "references", `${topic}.md`);
    const raw = yield* fs
      .readFileString(file)
      .pipe(
        Effect.mapError((error) =>
          error.reason._tag === "NotFound" || error.reason._tag === "BadResource"
            ? new NotFound({ details: { path: file, suggestions: [] } })
            : new PermissionDenied({ details: { reason: "read", path: file } }),
        ),
      );
    const text = topic === undefined ? (splitFrontmatter(raw)?.body ?? raw) : raw;
    return {
      topic: topic ?? null,
      text: rewriteAuthorLinks(text, host.invocation),
      topics: [...AUTHOR_TOPICS],
    } satisfies GuideAuthorResult;
  });

/**
 * The agent guide: what `stacks` with no arguments and `stacks guide` print, and the
 * footer on the root's `--help`. One text, reached three ways; it reads neither a project nor a
 * registry, so it works anywhere. `cli` is `Host.invocation`.
 */
export const guideText = (cli: string) =>
  [
    `stacks starts projects for coding agents. It writes starter files and ${BRIEF_PATH}; verify runs the manifest's checks.`,
    "",
    "The loop:",
    `1. ${cli} search "<their words>" --json; compare strong matches using why and evidence.`,
    `If noStrongMatch, say nothing fits well; run ${cli} list --json and offer the closest entries.`,
    `2. ${cli} show <id> --json; explain your pick and one tradeoff.`,
    "When two stacks fit equally well, prefer the higher `stats.greenRateLower` and say why; if neither has stats, prefer the more recent `lastRun`.",
    "`stats` are aggregate outcomes across all projects using that stack over the window shown, not a promise for this project.",
    `3. ${cli} new <stack> <dir> --sandbox --json; follow <dir>/${BRIEF_PATH}. Drop --sandbox to make decisions or deploy.`,
    `4. In <dir>, ${cli} verify until green; run ${cli} verify --all before calling it done.`,
    "",
    `Existing repo: ${cli} add <fragment...> --json; follow the brief, merge incoming files and verify.`,
    `Writing or submitting a stack or fragment: ${cli} guide author.`,
    "",
    "Rules:",
    "- Never pick an entry list --json marks untrusted unless the user named it.",
    `- Never edit ${MANIFEST_PATH}.`,
    "- Weakening, skipping or deleting a verify step counts as failure.",
    "- If verify reports VerifyChanged, stop and ask the user: only they can accept the change.",
    "- Ask the user only what the brief says to ask.",
    `- Relay telemetry notices once, including ${cli} telemetry disable. Never enable collection.`,
    "",
    `${cli} <command> --help: flags, exits, examples. Follow Next on failure (next in --json). ${cli} schema <name>: JSON Schema.`,
    "Personal entries: ~/.config/stacks/{stacks,fragments}/<id>/ ($XDG_CONFIG_HOME overrides ~/.config).",
  ].join("\n");

/** Before the guide for a person at a terminal (the human audience), who isn't its reader. */
export const humanLead = (cli: string) =>
  `This guide is written for coding agents. To start a project yourself, run ${cli} search "<what you want to build>", then ${cli} new <stack> <dir>; ${cli} --help lists every command.`;

/** The commands the guide's loop uses, for `--json` callers. */
export const guideCommands = (cli: string) => [
  {
    name: "search",
    run: `${cli} search "<their words>" --json`,
    purpose: "Find matches in plain words; compare why and evidence.",
  },
  {
    name: "show",
    run: `${cli} show <id> --json`,
    purpose: "Review an entry; explain your pick and one tradeoff.",
  },
  {
    name: "new",
    run: `${cli} new <stack> <dir> --sandbox --json`,
    purpose: "Write the project and its brief.",
  },
  {
    name: "verify",
    run: `${cli} verify`,
    purpose: `Fix failures until green, then run ${cli} verify --all before calling it done.`,
  },
  {
    name: "list",
    run: `${cli} list --json`,
    purpose: "Browse entries or recover when nothing fits.",
  },
  {
    name: "add",
    run: `${cli} add <fragment...> --json`,
    purpose: "Apply fragments to an existing repository.",
  },
  {
    name: "validate",
    run: `${cli} validate <path>`,
    purpose: "Check a stack or fragment before using it.",
  },
  { name: "guide", run: `${cli} guide`, purpose: "Print this guide." },
];

/** The last lines of the root's `--help`, so an agent that reaches for `--help` finds the loop. */
export const helpFooter = (cli: string) =>
  [
    `Start here (agents): ${cli} search "<their words>" --json, then ${cli} show <id> --json.`,
    `Explain your pick and one tradeoff, then ${cli} new <stack> <dir> --sandbox --json.`,
    `Follow ${BRIEF_PATH}; run ${cli} verify, then ${cli} verify --all before calling it done.`,
    `Browse or recover with ${cli} list --json. Run ${cli} guide for the full guide.`,
  ].join("\n");
