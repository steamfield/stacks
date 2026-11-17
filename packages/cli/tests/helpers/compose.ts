import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { AgentId } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { AppConfig } from "../../src/config";
import { targetAgents } from "../../src/core/compose/agents";
import { compose } from "../../src/core/compose/compose";
import type { ComposeOptions } from "../../src/core/compose/types";
import { Registry } from "../../src/core/registry/registry";
import type { RegistryRoots } from "../../src/core/registry/roots";
import { tempDir } from "./cli";
import { composeRegistry } from "./registry";

export const bundledAt = (path: string): RegistryRoots => [{ origin: "bundled", path }];

/**
 * `compose` over real registry roots, with `always` and `agents` taken from a real `config.json`
 * in a temporary XDG directory (written only when `config` is given), the way `new` will read
 * them. `agents` here plays `new --agents`.
 */
export function composeExit(
  options: Partial<Omit<ComposeOptions, "always" | "agents">> & { agents?: AgentId[] },
  setup: { roots?: RegistryRoots; config?: unknown } = {},
) {
  const dir = tempDir();
  const xdg = join(dir.path, "config");
  if (setup.config !== undefined) {
    mkdirSync(join(xdg, "stacks"), { recursive: true });
    writeFileSync(join(xdg, "stacks", "config.json"), JSON.stringify(setup.config));
  }
  const program = Effect.gen(function* () {
    const settings = yield* (yield* AppConfig).get;
    return yield* compose({
      stack: "web-stack",
      with: [],
      without: [],
      preset: "default",
      mode: "new",
      ...options,
      always: settings.always ?? [],
      agents: targetAgents(options.agents, settings),
    });
  });
  return Effect.runPromiseExit(
    program.pipe(
      Effect.provide(Registry.layer(setup.roots ?? bundledAt(composeRegistry))),
      Effect.provide(AppConfig.memory({ HOME: dir.path, XDG_CONFIG_HOME: xdg })),
      Effect.provide(NodeServices.layer),
    ),
  ).finally(dir.cleanup);
}
