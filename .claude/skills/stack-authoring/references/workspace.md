# Workspace stacks in the checkout

A workspace stack (a stack with `parts`) is the glue between an API stack and a client stack. The format, the role rules, placement and the required headings are in `packages/cli/docs/authoring.md` ("Workspace stacks"); read it first. This page is the checklist for writing one in the bundled registry, from what setup and feature agents needed in a hand-built workspace and did not find.

## The rule for every line

Anything about one half goes in that half's stack. The workspace body holds only what is true of this pair and of neither half alone. If a fact would hold for the part in a standalone project, move it to the part's `STACK.md` (and its `files/`), and report the change if that stack isn't yours to edit. Keep the body near 400 words; the composed brief carries both part bodies and the link, and a workspace's composed brief may reach 7,500 words.

## Required headings and what each must answer

- `## How the parts connect`: the request path from the client to the API (base URL, the dev proxy, the `/api` and `/v1` prefixes), which part owns the contract, and what crosses the boundary: the example resource, the error fields the client reads (status and `x-request-id`), any header both sides rely on.
- `## Setup`: one ordered sequence across both parts, ending in `stacks verify`. It names the step that first produces the link's generated output, and orders client generation before the client's typecheck and tests, which fail until it exists. It refers to a part's setup by what each step does ("add the backend's declared dependencies and record the Python version"), never by number: "do their steps 1 and 2" skipped the step that records versions.
- `## Changing the API`: change a route, regenerate the document and the client, update the client code, commit the regenerated output with the change, run both parts' tests and the root full check.

The body names every part directory at least once.

## The cross-part inventory

Check the body (or the root files it points to) answers each of these:

- [ ] Setup order across the parts: install both, generate the document and the client, then the checks.
- [ ] Where the contract comes from and where it goes: the API part's `openapi.json` is the source, the root target copies it into the client part, the generated client is read-only.
- [ ] What an API change does to the client: renamed operations rename generated hooks, a new route needs a regeneration.
- [ ] The request path: proxy, base URL, which paths are forwarded.
- [ ] Configuration that crosses the boundary: ports, the API base URL, settings both parts read.
- [ ] Cross-part tests: which tests need both parts running, and that they cover more than the example resource. A both-parts check that only calls `notes` stays green while a new resource is broken; the change workflow says to extend it with each resource.
- [ ] Root commands and what each wraps (`make -C backend lint`, `cd frontend && bun run lint`).
- [ ] CI per part, inside a `<!-- stacks:when with=ci-github -->` block: each part's toolchain setup (where the Python, Node or Bun version is read from) and its check commands, plus the job that needs both parts. The parts' own `with=ci-github` blocks drop when mounted, and the root `ci-github` body sees only the workspace's tags.
- [ ] Git hooks per part, inside a `<!-- stacks:when with=git-hooks -->` block: a lefthook job per part with `root:`, Biome run from inside the part, and that the root install target runs `lefthook install`.
- [ ] How a fragment on one part shows on the other, for each optional fragment the workspace offers (after `postgres` on the API part, regenerate the client for the readiness route). A fragment that affects every workspace says so in its own body instead (`fragment-authoring`).
- [ ] Where settings come from: the root `.env`, and how its values reach each part (through the root Makefile's export; a part that reads its own `.env` doesn't see the root one).

## Files the workspace ships, and the mistakes to check for

The workspace's `files/` holds only root files. Check each:

- [ ] Root `AGENTS.md`, with a `CLAUDE.md` that imports it: cross-part commands, the change workflow, where each part's commands run, links to the contract document and each part's guidance. With `claude-harness` required, `agent-ops` writes both at the root and the parts get none, so the workspace ships neither (it would be a `file_owner` conflict): its Setup says what goes in the root `AGENTS.md`, including what each part section asks of "AGENTS.md", and a hygiene step greps for it (`hono-react`'s `agents-md-workspace`). Never tell the agent to fill a root file nothing writes.
- [ ] A `make`-tagged workspace gets its root `AGENTS.md` commands table filled with `make <part>-<command>` rows, one per part command, so the Makefile answers to them (`hono-react` uses `backend-%` and `frontend-%` pattern rules).
- [ ] Root `README.md` with its own `readme-filled` step (a workspace project has three: the root and each part), and a root `.env.example` listing every port and setting the root Makefile exports.
- [ ] A short contract document (`docs/CONTRACT.md`): request path, contract owner, change workflow. A verify step checks it names each part directory and holds no fill marker.
- [ ] The root Makefile delegates to each part and runs Biome inside each part; a Biome run from the root fails on the parts' root configs.
- [ ] The root Makefile doesn't let an included `.env` override a port exported in the shell: `PORT_API=9100 make <both-parts target>` uses 9100 even when `.env` sets another port. A plain `-include .env` silently overrides exported values.
- [ ] The both-parts check (both servers up, one request through the client's proxy) exits 0 and prints nothing alarming on success. Its teardown must not print a server's exit status (143 from SIGTERM) or a make error.
- [ ] Cross-part tests reach more than the example resource, or the change workflow tells the agent to add the new resource to them.
- [ ] The workspace's `required` tier restates every fragment either part requires and lists the link.
- [ ] Ports: the API part's `PORT_API` and the web part's `PORT_WEB` defaults don't collide with each other or with the test ports in `.env.example`.

## Proving it

Prove the workspace as `fresh-scaffold-proof.md` describes, then run the feature task too: a fresh agent adds a second resource end to end (a route, the regenerated client, a page that uses it, tests in both parts) from the project's `AGENTS.md` and contract document alone. Record every question it asks and every wrong-directory command or wrong-copy edit, and fix the layer that should have prevented it: a part body, the link body or the workspace body. A change to a part stales every workspace that uses it, so list those proofs as pending.
