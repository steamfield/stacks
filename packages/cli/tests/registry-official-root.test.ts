import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { ValidateReport } from "../src/schemas/validate";
import { quiet, runCli } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.runIf(process.platform === "darwin")(
  "validate reports findings when the allowlist marker cannot be inspected (macOS)",
  async () => {
    const home = realpathSync(space.dir());
    const root = join(home, "registry");
    const marker = join(root, "allowlist.json");
    mkdirSync(join(root, "stacks"), { recursive: true });
    writeFileSync(marker, "{}");
    // A file ACL denies stat and reads of the marker while keeping the registry traversable.
    execFileSync("chmod", ["+a", "everyone deny readattr,read", marker]);

    try {
      const result = await runCli(["validate", root, "--json"], {
        home,
        env: quiet,
        host: { registry: emptyRegistry },
      });

      expect(result.status, result.stderr).toBe(2);
      const report = Schema.decodeUnknownSync(Schema.fromJsonString(ValidateReport))(result.stdout);
      expect(report.findings).toMatchObject([
        { check: "deps-invalid", severity: "error", file: "allowlist.json" },
        { check: "registry-meta", severity: "error", file: "registry.json" },
      ]);
      const { error } = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorEnvelope))(
        result.stderr,
      );
      expect(error).toMatchObject({
        tag: "ValidationFailed",
        details: { errors: 2, warnings: 0 },
      });
    } finally {
      unlinkSync(marker);
    }
  },
);
