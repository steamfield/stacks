/**
 * The fixed text `stacks create` writes for a new skeleton entry (the stack or fragment Markdown
 * file and a stack's starter files), and the question it asks before copying an untrusted entry.
 *
 * `core/create.ts` uses these after it has checked the id, so the id is safe to place in the
 * frontmatter. The skeleton leaves `stacks:fill` markers for the author to replace; the submission
 * checks in `validate/submission.ts` flag any left before an entry is submitted. The text lives
 * apart from `create.ts` so the long templates don't bury the logic.
 */
import type { Category, Kind } from "@steamfield/stacks-format";

/**
 * Fixed entry-format-v1 scaffolding; rendered only after the id has been validated. `category`
 * applies to fragments only.
 */
export function skeleton(kind: Kind, id: string, category: Category): string {
  return kind === "stack" ? stackSkeleton(id) : fragmentSkeleton(id, category);
}

/** A stack that verifies through make targets, with every brief section to fill in. */
function stackSkeleton(id: string): string {
  return `---
schema_version: 1
id: ${JSON.stringify(id)}
kind: stack
name: ${JSON.stringify(id)}
description: "stacks:fill: describe the stack"
tags: [make]
deps: {}
commands:
  install: Install dependencies
  lint: Run lint
  typecheck: Check types
  test: Run tests
tools: []
decisions: ["Project layout (default: a single package)."]
env: {}
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, phase: check, layer: lint, run: make lint }
  - { name: typecheck, phase: check, layer: typecheck, run: make typecheck }
  - { name: test, phase: check, layer: test, run: make test }
  - name: readme
    phase: check
    layer: docs
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
merge: []
fragments: { required: [], default: [], optional: [] }
---
## Layout

Describe the project's directories.

## Setup

Describe setup steps.

## Conventions

Describe the coding conventions.

## Tool configuration

Describe what the tools must enforce.

## Testing

Describe the test strategy.

## Commands

Describe the project commands.

## Gotchas

Describe common mistakes.
`;
}

/** A fragment with no verify steps yet; an app fragment gets the application sections. */
function fragmentSkeleton(id: string, category: Category): string {
  return `---
schema_version: 1
id: ${JSON.stringify(id)}
kind: fragment
name: ${JSON.stringify(id)}
description: "stacks:fill: describe the fragment"
tags: []
deps: {}
commands: {}
tools: []
decisions: []
env: {}
verify: []
merge: []
category: ${category}
applies_to: []
needs_own_repo: false
requires: []
conflicts: []
requires_tools: []
---
${category === "app" ? appBody : fragmentBody}`;
}

const fragmentBody = `## What to add

Describe what to add.

## Tool configuration

Describe the tool requirements.

## Verify

Describe how to verify the result.

## AGENTS.md

Describe what the agent needs to know.
`;

const appBody = `## What to build

Describe the application.

## Features

Describe the features.

## Acceptance tests

Describe how to prove it works.
`;

/** The files a stack skeleton ships under `files/` besides its `STACK.md`. */
export const starterFiles = [
  { source: "files/.gitignore", text: ".stacks/state/\n" },
  {
    source: "files/README.md",
    text: "<!-- stacks:fill: describe the project and its commands -->\n",
  },
];

/** Asked after an untrusted entry's full report, unless `--yes` was given. */
export const trustQuestion = "Copy this entry into your trusted user registry? [y/N]";
