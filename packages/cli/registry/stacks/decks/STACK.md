---
schema_version: 1
id: decks
kind: stack
name: Decks presentation slides (React and MDX)
description: A presentation project for Decks slide decks, written in MDX with React components, motion and charts, served live and built to a static site by the decks command, with the Decks agent skills and Claude Code plugin set up.
tags: [typescript, react, web, static, slides, scripts, bun, node]
deps:
  decks: ["@steamfield/decks", react, react-dom]
  dev: [typescript, "@types/react", "@types/react-dom", "@types/node"]
tools: [bun, node, git]
decisions:
  - "First deck: a conventional deck with a cover and one three-point slide (default), or a story deck (`--story`) with a stage, story cards and a data module when the person wants a data-driven talk."
  - "Deck alias: the project slug (default), the name the shipped package.json scripts pass to `decks`. A different alias means editing those scripts to match."
  - "Name on the cover: the person's git `user.name` (default), passed as `--author`; the template's placeholder when git has none."
  - "Node version: current LTS (default), recorded in .node-version. The decks command runs on Node; Bun installs and runs scripts."
merge: [.claude/settings.json]
fragments:
  default: [agent-ops]
  optional: [git-hooks, ci-github, ce-plugin, rr]
env:
  PORT_WEB: "3030"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: build, layer: build, run: bun run build }
  - name: example-build
    layer: build
    run: "test ! -f decks/example/deck.config.ts || bun run decks build example"
  - name: agent-setup
    layer: check
    run: "test ! -L .agents/skills && test -f .agents/skills/.decks-init.json && test -f .agents/skills/working-with-decks/SKILL.md && test -f .agents/skills/building-a-deck/SKILL.md && test -f .agents/skills/writing-slides/SKILL.md && grep -q '\"decks@steamfield\": true' .claude/settings.json && grep -q 'decks:start' AGENTS.md"
  - name: web
    phase: serve
    layer: serve
    run: "bun run dev --port ${PORT_WEB}"
    expect: { http: "http://localhost:${PORT_WEB}/", within: 60s }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  decks: The installed decks command (bun run decks new <alias>, decks init, decks shot ...)
  dev: Serve the project's deck with live updates (first free port from 3030, or --port)
  build: Build the deck to a static site in dist/<alias>/
  lint: Lint every registered deck's prose for error-level patterns
  typecheck: Run tsc over the decks' config, setup and component files
  test: Check decks.json, every deck's config and slides, slide names and prose (decks check)
  check: decks check, typecheck, then build
  clean: Remove build output
---

# Decks slide decks

## What stacks wrote

A Bun project shell for Decks: `package.json` scripts that drive the installed `decks` command for one deck named after the project, a strict `tsconfig.json` over `decks/`, `.gitignore`, a README to fill, and Claude Code permissions for the scripts. The project's own deck and the agent setup come from the framework's own commands in Setup, so they match the installed release. Read the shipped files and then the installed guide at `node_modules/@steamfield/decks/docs/` before writing slides.

<!-- stacks:when payload=example -->
It also wrote `decks/example/`, a four-slide reference deck registered as `example` in `decks.json`: a cover, one claim with bullets revealed by `Steps` and per-click speaker notes, a figure drawn by a deck component from `data/03-words.ts` with its source in `data-sources.md`, and a close. Its figure is hand-drawn to stay small; a real chart uses the kit's `OpenChart`. Read it before writing the first slide; it follows the Decks skills, so copy its patterns rather than inventing markup. README's "Run the example deck" section tells the person how to present it. Keep it unless the person asks to remove it; removing it means deleting `decks/example/` and its `decks.json` entry. `stacks new decks <dir> --payload none` leaves it out.
<!-- stacks:end -->
<!-- stacks:when payload=none -->
It wrote no example deck (`--payload none`); `decks.json` comes from `decks new` in Setup.
<!-- stacks:end -->

## Layout

Each deck lives in `decks/<alias>/` and is registered in `decks.json`; `decks new` does both. A deck holds `deck.config.ts`, `slides/NN-slug.mdx`, and optionally `setup.ts`, `styles/index.css`, `components/*.tsx`, `layers/`, `public/` and `data/`. Build output goes to `dist/<alias>/`. Another deck is `bun run decks new <alias>`; the shipped scripts serve and build only the project's own deck (the alias in `package.json`), so run `bun run decks dev <alias>` for others.

## Setup

1. Add the `decks` dependencies with `bun add` and the `dev` dependencies with `bun add -d`, resolving current releases. The package is `@steamfield/decks`; never install the unrelated `decks` package.
2. Scaffold the first deck through the installed command, with the alias the scripts name (the `name` in `package.json`): `bun run decks new <alias> --author "<name>"`, adding `--story` if the person chose a story deck. Run it from the project root: it writes only `decks/<alias>/` and `decks.json`, which is how Decks registers a deck, so it is the exception to running generators in a subdirectory. It adds the alias to an existing `decks.json` and keeps the entries there. Don't create `decks.json` entries or the deck files by hand.
3. Run `bun run decks init`, which runs the installed `node_modules/.bin/decks`. This step is required: it is how the project gets the Decks agent guidance. It enables the Decks Claude Code plugin in `.claude/settings.json` pinned to the installed version, copies the Decks skills (`working-with-decks`, `building-a-deck`, `writing-slides`, `deck-design`, `deck-motion`, `visualization`, `deck-data`) to `.agents/skills/`, and adds a Decks section to `AGENTS.md`, keeping what stacks and the fragments wrote. If it fails, stop and report its output to the person; never copy the skills or write the section by hand. Leave the files it writes as they are, and read `working-with-decks` before writing any slide.
   `decks init` owns `.agents/skills/` and refuses to write through a symlink, so keep it a real directory: where the AGENTS.md harness section asks to merge `.agents/skills` into `.claude/skills` behind a symlink, skip that move in this project, and write there that the Decks skills live in `.agents/skills/` for Codex and reach Claude Code through the Decks plugin. Project skills of your own go in `.claude/skills/`.
4. Record the installed Bun in `packageManager` and Node in `.node-version`.
5. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run build`. Where the installed release rejects shipped config, update the config for that release without loosening `strict` or dropping a check.
6. Fill README's `stacks:fill` markers, finish the selected fragments, then run `stacks verify` until green. Tell the person to run `claude plugin install decks@steamfield --scope project` once if they use Claude Code; it installs into their own Claude Code, so don't run it for them.

## Conventions

- Writing or revising a deck follows the Decks skills in `.agents/skills/` (Claude Code gets the same ones from the plugin): start with `working-with-decks`, then `building-a-deck`; slide prose follows `writing-slides`; charts follow `visualization` and then `deck-data`, and every other figure follows `deck-data`.
- Run the CLI through the project's scripts (`bun run decks ...`) so the installed version runs.
- Slide files are `NN-slug.mdx` with unique two-digit prefixes; slide order is filename order.
- Figures on slides come from `data/*.ts` constants with their source recorded in the deck's `data-sources.md`.

## Testing

`bun run test` (`decks check`) loads every registered deck's config, reads each slide's frontmatter and MDX to count its clicks, and fails on registry, naming, click-count and error-level prose problems; it doesn't compile the MDX, so an undefined component shows up only in a build. `bun run typecheck` covers `deck.config.ts`, `setup.ts`, `components/` and `data/`. `bun run build` proves the project's deck compiles, and the `example-build` verify step builds `decks/example/` while it exists. None of them shows whether a slide fits on screen: capture frames with `bun run decks shot <alias> <slide>` and look at them, which needs Chromium (`npx playwright install chromium`, as the command says when it is missing).

## Commands

`bun run dev`, `build`, `lint`, `typecheck`, `test`, `check` and `clean`, plus `bun run decks <command>` for `new`, `init`, `shot` and `export`. `bun run decks <command> --help` prints the installed flags.

## Gotchas

- `npx decks` and `bunx decks` fetch the unrelated `decks` package. Outside the scripts, use `bunx -p @steamfield/decks decks`.
- An explicit `--port` is strict: `decks dev` fails when the port is taken instead of moving on.
- `decks init` keeps a skill file or the `AGENTS.md` section that was edited since it last ran; `--force` replaces them. After upgrading `@steamfield/decks`, run it again so the skills and the plugin pin match the new release, then `claude plugin update decks@steamfield --scope project`.
- `decks build` empties its output directory and refuses one it didn't write; keep other files out of `dist/`.
- `decks build` writes `og.png` with Chromium and only warns when it is missing, so a build without Chromium still passes.
- `decks check` passing doesn't mean the slides compile; build the deck you changed.
- `decks init` writes `.claude/settings.json` even when Claude Code isn't a target. agent-ops' `hooks-smoke` checks every hook config present, so wire its guards into that file too: add the `hooks` block agent-ops writes for Claude Code (each event running its script in `.claude/hooks/`, which every scaffold has), keeping the plugin keys `decks init` added. Don't delete the file; the next `decks init` writes it again.
<!-- stacks:when payload=example -->
- The example deck holds the alias `example`, so a project named `example` can't register its own deck under that name: tell the person, and remove the example deck first if they want to keep the name.
<!-- stacks:end -->
