# Writing a search card

The search card is a JSON file beside the entry directories that tells `<cli> search` and the hosted directory which requests the entry answers. For a user entry it lives at `~/.config/stacks/search/stacks/<id>.json` or `search/fragments/<id>.json`. `create` writes no card; you write it. A personal card is optional. A submission should include one; without it, a maintainer drafts the card.

## The card

```json
{
  "schemaVersion": 1,
  "kind": "stack",
  "id": "go-cli",
  "source": {
    "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "by": "author",
    "reviewedAt": null
  },
  "summary": "A Go command-line tool with subcommands, configurable settings, actionable errors and human or JSON output.",
  "description": "Write a Go utility with Cobra subcommands and Viper settings layered from defaults, files, environment and flags. ...",
  "seoDescription": "A Go CLI recipe with Cobra subcommands, layered Viper configuration, actionable errors and human or JSON output.",
  "projectExamples": [
    { "title": "Configuration inspector", "description": "Add commands that explain effective settings and show where overrides came from." },
    { "title": "Release artifact checker", "description": "Check local archives and checksums, then add goreleaser to distribute the tool.", "withFragments": ["goreleaser"] }
  ],
  "plain": {
    "whatItIs": "A starter for a terminal program written in the Go language, with settings and clear error messages.",
    "goodAt": ["Commands that read settings from files, environment variables and flags"],
    "notGoodAt": ["Graphical apps with windows and buttons; choose a web or desktop stack."]
  },
  "platforms": [],
  "productKinds": [],
  "languages": [],
  "requests": [
    "build a terminal utility whose commands also work in scripts",
    "let users override saved settings with environment variables and flags",
    "make command failures explain how to fix the problem"
  ],
  "useCases": ["command-line automation", "configurable utilities"],
  "synonyms": ["cobra", "viper", "single binary", "subcommands"],
  "goodFor": ["configuration precedence", "table-driven command tests"],
  "notFor": []
}
```

A fragment card has `"kind": "fragment"` and `capabilities` instead of `platforms`, `productKinds` and `languages`.

## Provenance

Set `source.by` to `"author"`, `reviewedAt` to `null` and `digest` to `sha256:` followed by 64 zeros. Never set `reviewedAt`: it records a maintainer's review. `validate` notes the placeholder digest on an unreviewed author card; don't try to compute it by hand. `<cli> submit` stamps the real digest.

## Closed vocabulary

Start every facet array as `[]` and fill it only with these values. Anything else fails validation.

| Field | Kind | Values |
| --- | --- | --- |
| `platforms` | stack | `ios`, `android`, `mobile`, `web`, `desktop`, `cli`, `server` |
| `productKinds` | stack | `blog`, `content-site`, `api`, `web-app`, `mobile-app`, `desktop-app`, `cli-tool`, `ai-app`, `fullstack` |
| `languages` | stack, 1 to 3 | `typescript`, `python`, `go`, `rust`, `swift`, `kotlin` |
| `capabilities` | fragment, 0 to 3 | `auth`, `database`, `analytics`, `deploy`, `ci`, `release`, `ai`, `git-hooks`, `agent-harness` |

List every platform the entry runs code on: an app with an API is `server` as well as `web` or `mobile`. A stack that serves JSON routes but lists no `server` is penalized on every request containing "api" or "backend". Don't add a product kind that is a sibling's main job. A fragment inherits languages and platforms from the stacks in its `applies_to`.

## Field limits

| Field | Limit |
| --- | --- |
| `summary` | One sentence, at most 25 words: what you get and where it runs |
| `requests` | 3 to 5, at most 15 words each |
| `useCases` | Up to 6 short phrases |
| `synonyms` | Up to 12 |
| `goodFor`, `notFor` | Up to 4 each |
| `caveats` (optional) | Up to 3 platform or operating limits, at most 25 words each |
| `description` | At most 120 words |
| `seoDescription` | At most 160 characters |
| `projectExamples` | 1 to 3, each a `title` (8 words) and `description` (35 words) |
| `plain` | `whatItIs` (30 words), 1 to 3 `goodAt` and `notGoodAt` items (15 words each) |

The search fields together (`summary`, `requests`, `useCases`, `synonyms`, `goodFor`, `notFor`, `caveats`) stay within 150 words.

## How to fill each field

Search reads the card with weighted fields. `requests` weigh most, then the id and name, then the frontmatter `description`, `summary`, `useCases` and `synonyms`. A strong match needs at least half the request's words in those fields; a word only in `goodFor` or the body never makes an entry a strong hit. Common words ("app", "tool", "project", "build", "use", "make") are dropped before matching.

- **`requests`**: things a developer would type, each a different need in their own words. Only the closest one scores, so five phrasings of one request count as one. Never describe an optional fragment as built in: "start a web app I can add an AI chat to", not "build an AI chat app".
- **`synonyms`**: other names people search with. The predecessor or rival ("Remix" for React Router, "Electron alternative" for Tauri), the plain word a compound hides ("Docker" when only "Dockerfile" appears), and the plain phrasing of a niche tool.
- **`notFor`**: leave it empty at first. A `notFor` match demotes the entry below every strong hit, so add a phrase only for a near miss you saw in testing, and check that a request the entry should still win, containing that word, isn't demoted. A phrase must never contradict what the files ship.
- **`goodFor`, `useCases`, `caveats`**: needs the entry supports. Put a real operating limit in `caveats` ("Local development needs Docker for the database").
- **Editorial fields** (`description`, `seoDescription`, `projectExamples`, `plain`): plain prose for people browsing the directory. Say what the entry sets up, then what a product still needs. Project examples are illustrative: list the fragments they need in `withFragments` (up to 3), and on a fragment card name the host `stack`. Write `plain` for someone new to the ecosystem, explain any technical word in the same sentence, and include no version numbers.

Don't invent compliance, readiness, pricing or timing claims, and don't imply auth or persistence the entry doesn't ship.

## Test the card

Run realistic requests through the local ranker and read the order and tier, not just the top hit:

```sh
<cli> search "a go cli with config files" --local --kind stack --json
<cli> search "github actions ci" --local --kind fragment --json
```

Try five requests the entry should win, three it should lose to an existing entry, and any near miss you added a `notFor` for. Adjust your own card until the order is right; never edit another entry's card to make yours win. Keep two of the winning requests, phrased differently from your card's `requests`, to propose with `<cli> submit --query`.
