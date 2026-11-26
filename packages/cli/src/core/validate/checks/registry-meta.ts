/** Reports unusable registry metadata on official roots. */
import { Effect, Result } from "effect";
import { officialRoot, REGISTRY_META_FILE, readRegistryMeta } from "../../registry/meta";
import type { Check } from "../types";

export const registryMetaChecks: Check = Effect.fn("validate.registryMeta")(function* (view) {
  if ((yield* officialRoot(view.root)) === "absent") return { findings: [] };

  const read = yield* Effect.result(readRegistryMeta(view.root));
  if (Result.isSuccess(read)) return { findings: [] };
  const { message, requiresNewerCli } = read.failure;
  return {
    findings: [
      {
        check: "registry-meta",
        severity: "error",
        file: REGISTRY_META_FILE,
        message: requiresNewerCli ? `${message} Run stacks validate with a newer CLI.` : message,
      },
    ],
  };
});
