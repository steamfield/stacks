---
paths:
  - "src/**"
  - "tests/**"
  - "scripts/**"
  - "package.json"
---

# Before calling work done

[Verification guidance](../../../docs/guidance/typescript-library/verification.md), the shared guidance for every selected agent, has the detail.

- Run `bun run gate` after each change and read the counts; a clean exit isn't a pass.
- After touching `package.json`, `tsdown.config.ts`, `src/index.ts` or a public type, run `bun run lint:package` and `bun run test:consumer`, and read the new exports in `dist/index.d.ts`.
- Before calling work done, review the diff: run the `reviewer` agent when `.claude/agents/reviewer.md` exists, otherwise check it yourself against AGENTS.md and the rules in `.claude/rules/typescript-library/`. Fix what it finds, then run `stacks verify --all`.
- Never publish, bump the version or push tags to check something.
- Don't report a cause you didn't observe; quote the output.
