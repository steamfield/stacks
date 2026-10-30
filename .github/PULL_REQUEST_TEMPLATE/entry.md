<!--
A registry entry: a new or updated stack or fragment under packages/cli/registry/.
`stacks submit` fills this in for you. For a manual PR, open it as a draft and fill in each section.
-->

## Entries

<!-- For each entry: kind, id, and its frontmatter description. Say whether it's new or an update. -->

## Validation

<!-- Paste the summary of `stacks validate <entry-dir> --submission`. List any warnings left: only search-unreviewed, search-missing, missing-card, deps-missing and deps-unreviewed may remain. -->

## Proof

<!-- The sandbox build: `stacks new <id> <dir> --sandbox`, built from the brief, with `stacks verify` green. Name the agent and anything you had to fix in the entry. -->

## Proposed search queries

<!-- Two requests this entry should rank first for, phrased differently from the card's `requests`. -->

## Licensing

- [ ] I have the right to license every file in this entry under Apache-2.0, including `files/` and `adapters/`.

## Maintainer checklist

CI stays red on a new entry until these are done. Leave them for a maintainer.

- [ ] The login in `packages/cli/registry/authors.json` equals the PR author
- [ ] Security review of `files/` and `adapters/` (hooks and settings run in users' projects)
- [ ] Search card reviewed and restamped
- [ ] New packages added to `allowlist.json`, with dependency cards
- [ ] Golden queries added, and existing golden rankings checked for shifts
- [ ] Bench run recorded
- [ ] CI green before the PR leaves draft
