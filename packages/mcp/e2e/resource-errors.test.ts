import { expect, it } from "vitest";
import { runCli, withSdk } from "./helpers/session";

it.each(["does-not-exist", "--help"])(
  "an invalid author topic %s preserves the CLI diagnostic and next action",
  (topic) =>
    withSdk(async ({ client, box }) => {
      const cli = runCli(box, ["guide", "author", "--", topic]);
      expect(cli.status).toBe(2);
      expect(cli.stdout).toBe("");
      expect(cli.stderr).toContain("Next:");
      await expect(
        client.readResource({ uri: `stacks://guide/author/${topic}` }),
      ).rejects.toMatchObject({ code: -32602, message: `MCP error -32602: ${cli.stderr.trim()}` });
    }),
);
