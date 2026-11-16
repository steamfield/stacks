# Feature request: a stack (or fragment) for tree-shakeable React component libraries

Status: PROPOSED 2026-11-02. Not scheduled. Raised while scaffolding `@steamfield/ui`, a
shared component library for five landing and docs sites.

## Problem

`stacks search "react component library npm package tree-shakeable"` returns `typescript-library`
as the only strong match. It is the right base: Bun + Node LTS, strict TypeScript with
`isolatedDeclarations`, tsdown, Biome with the Grit boundary plugin, Vitest, publint, attw and the
packed-tarball consumer check. But it targets a single-entry utility package, and a UI library
needs a different shape. Today an agent has to rework a large part of what the stack ships:

- One bundled entry. `tsdown.config.ts` builds `src/index.ts` only, `package.json` exports `.`,
  and `tests/public-api.test.ts` pins one export list. A component library needs unbundled output
  (one file out per file in) and one subpath export per component, each with its own pinned API.
- `sideEffects: false`. Per-component CSS files need `sideEffects: ["**/*.css"]` and CSS subpaths
  in `exports`. tsdown doesn't copy CSS that no JS imports, so the build needs a copy step, and
  attw may need scoping to the JS entries.
- No DOM testing. No React or Vue peer setup, no happy-dom or Testing Library, and no
  `.tsx` conventions under `isolatedDeclarations`, which needs explicit return types on every
  exported component and hook.
- No proof of tree-shaking or size. Nothing measures bytes per entry or proves that importing
  one subpath leaves the others out of a consumer bundle.
- No visual or a11y harness. There's no playground to render components for manual QA, and no
  Playwright + axe check of it (including `reducedMotion: 'reduce'`).
- No versioning flow. A library with several downstream sites wants Changesets.
- The Grit internal-export rule matches only `src/index.ts`, not `src/**/index.ts`.

## Proposal

Either a `react-component-library` stack, or a `component-library` fragment that applies to
`typescript-library`. The fragment is probably the better fit, because everything below sits on
top of the library stack's checks rather than replacing them.

What it adds:

- tsdown in unbundled mode over `src/**/index.ts(x)`, `exports` generated or checked per subpath
  (`types` + `import`), CSS subpath exports, and `sideEffects: ["**/*.css"]`.
- One export-list test per subpath, and `tests/consumer/` importing every subpath from the
  packed tarball.
- `react` / `react-dom` as `peerDependencies` (optional `vue`), happy-dom, Testing Library and a
  sample component with a behavior test.
- `playground/`: a Vite + React app rendering every component, plus Playwright + `@axe-core/playwright`
  run against it in normal and reduced-motion modes.
- `size-limit` with a budget per entry point (peers external).
- `fixtures/tree-shake/`: a Vite app importing one subpath. It builds, then greps the output to
  assert a sentinel from another subpath is absent, with a control build asserting the sentinel is
  present so the check can't pass vacuously.
- Changesets config and a `changeset` reminder in the agent rules.
- An import-graph test for the allowed dependency DAG between component folders (Grit can't
  express "same folder" back-references).
- `ci-github` jobs for size-limit, the tree-shake fixture and Playwright/axe.

## Verify steps to add

`size`, `tree-shake`, `a11y` (Playwright + axe over the playground), plus the existing
`typescript-library` steps.

## Open questions

- Fragment over `typescript-library`, or its own stack? A fragment keeps one source of truth for
  the publint/attw/consumer setup.
- Ship CSS layering guidance (`@layer` so Tailwind v4 utilities on `className` win) as part of
  the fragment's rules?
- Vue bindings as an option of the same fragment, or a later one?

## Motivating case

`@steamfield/ui` (MIT) is being scaffolded from `typescript-library` and
adapted by hand along the lines above. Once it is green, its config is a working reference for
the fragment's `files/`.
