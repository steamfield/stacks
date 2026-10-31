import { parse } from "yaml";

export function frontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match)
    throw new Error("Post must begin with YAML frontmatter between --- lines.");
  return parse(match[1]);
}
