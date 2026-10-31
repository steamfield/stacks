import { Schema } from "effect";
import { Kebab, type Kind } from "./entry.js";

/** A GitHub login: 1 to 39 letters, digits or single inner hyphens. */
export const GitHubLogin = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, {
    expected: "a GitHub login",
  }),
);
export type GitHubLogin = typeof GitHubLogin.Type;

/** Whether a key is `"stack/<id>"` or `"fragment/<id>"`, the key of an entry in an `AuthorsFile`. */
function isAuthorKey(key: string): boolean {
  const slash = key.indexOf("/");
  const kind = key.slice(0, slash);
  return (kind === "stack" || kind === "fragment") && Schema.is(Kebab)(key.slice(slash + 1));
}

/**
 * The registry's `authors.json`: the GitHub login of each submitted entry's creator, by
 * `authorKey(kind, id)`. Entries without a submitter have no row. Keys are checked on the whole
 * record because a refined `Record` key schema drops a non-matching key instead of failing.
 */
export const AuthorsFile = Schema.Record(Schema.String, GitHubLogin).check(
  Schema.makeFilter((authors) => {
    const bad = Object.keys(authors).find((key) => !isAuthorKey(key));
    return (
      bad === undefined || `expected "stack/<id>" or "fragment/<id>", got ${JSON.stringify(bad)}`
    );
  }),
);
export type AuthorsFile = typeof AuthorsFile.Type;

/** The `AuthorsFile` key for an entry. */
export const authorKey = (kind: Kind, id: string): string => `${kind}/${id}`;
