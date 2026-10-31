# Designing a new stack with the user

The user wants a stack for something that has no working repo yet ("make me a stack for a Rust CLI"). The user knows what they want to build; you know what makes an entry work. Help them get the best stack for their goal, not a transcription of their first sentence.

Search first: `<cli> search "<their words>" --json`, then `<cli> show <id> --json` for the closest two or three. If one covers most of the need, say so before asking anything else, since it can make the rest moot. Read the closest bundled entry in full as a model for structure.

## Ask in rounds

Ask at most five questions per round, the most consequential first. Give each one your recommended answer, so "yes" settles it. End the round with: Reply "defaults" to accept every recommendation.

Ask only what changes what you'll write, and don't ask what the search results or the user's words already answered. Cover these topics over as many rounds as it takes:

| Topic | What you need to know |
| --- | --- |
| Project kind and audience | What people will build from it, and who uses the result (a library, a CLI, an API, a web app, a mobile app) |
| Language and runtime | The language, its runtime and package manager, and the task runner (`make` or package scripts) |
| Framework | The main framework or libraries, and which are optional |
| Data | A database, an ORM, migrations, or none |
| Testing bar | Unit, integration, end to end; a coverage floor |
| Lint and typecheck | Which tools, how strict |
| CI and deploy | Which CI host, whether anything deploys or releases, and which of those belong in fragments |
| Agent setup | Which agents get adapters (Claude Code, Codex, OpenCode, Cursor), hooks, settings |
| Open choices | Which choices stay open for each project as `decisions`, and each one's default |

Name pieces the user left out that the goal needs, with the default you'd use and the existing entry that uses it: "You didn't mention tests; the other Rust and Go stacks use the built-in test runner plus an integration test of the binary. Add that?" Propose the id with two or three candidates and say which you'd pick.

Don't add product features nobody asked for. If an answer leaves a choice open, take the narrower reading and say so.

## When to stop asking

Keep going until you can do both of these:

1. Write a one-paragraph summary of the stack: what it builds, where it runs, the main packages, what's in the base and what's a fragment.
2. List every verify step with its command, for example:

| Step | Layer | Command |
| --- | --- | --- |
| install | install | `make install` |
| lint | lint | `make lint` |
| typecheck | typecheck | `make check` |
| test | test | `make test` |
| smoke | test | `make smoke` |

If either has a gap ("tests: something"), you aren't done. Ask another round.

## Get a yes before writing

Show the user the summary, the verify table and the id. Ask them to confirm or correct it. Write nothing, not even `<cli> create`, until they say yes. If they correct something, update the summary and confirm again.

Then continue with the workflow in SKILL.md: create, fill in per `references/anatomy.md`, validate, and prove it with a sandbox build.
