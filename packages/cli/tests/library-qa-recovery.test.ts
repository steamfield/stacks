import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { ListResult } from "../src/schemas/list";
import { quiet, runCli, terminal } from "./helpers/cli";
import { adapterRegistry, adapterWorkspace } from "./helpers/native-adapters";

const space = adapterWorkspace();
afterEach(() => space.cleanup());

test.each(["json", "agent", "human"])(
  "typo recovery supplies its own next command for %s",
  async (audience) => {
    const home = space.temp();
    const result = await runCli(
      ["new", "go-cl", "app", ...(audience === "json" ? ["--json"] : [])],
      {
        home,
        env: quiet,
        host: { registry: adapterRegistry, ...(audience === "human" ? terminal : {}) },
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    if (audience === "json") {
      const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr));
      expect(envelope.error).toMatchObject({
        tag: "NotFound",
        message: "Not found.",
        retryable: false,
        next: "run stacks list to see every stack and fragment id.",
        details: { suggestions: ["go-cli"] },
      });
    } else {
      expect(result.stderr).toContain("Did you mean: go-cli?");
      expect(result.stderr).toContain("Next: run stacks list to see every stack and fragment id.");
    }
    const next = await runCli(["list", "--json"], {
      home,
      env: quiet,
      host: { registry: adapterRegistry },
    });
    expect(next.status).toBe(0);
    expect(next.stderr).toBe("");
    expect(Schema.decodeUnknownSync(ListResult)(JSON.parse(next.stdout)).entries).toContainEqual(
      expect.objectContaining({ id: "go-cli" }),
    );
  },
);
