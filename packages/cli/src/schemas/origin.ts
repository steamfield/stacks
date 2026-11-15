/**
 * Which registry root an entry (a stack or fragment) was found in. The origin decides whether the
 * entry is trusted (`core/registry/registry.ts::trustOf`, "Trust model" point 2 in
 * `.claude/rules/architecture.md`), and `list` and `show` print it.
 */
import { Schema } from "effect";

/** Where an entry was found, from the highest-priority root to the lowest. */
export const Origin = Schema.Literals(["project", "user", "index", "bundled"]);
export type Origin = typeof Origin.Type;
