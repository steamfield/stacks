import { expect, it } from "vitest";
import { runCli, withSdk } from "./helpers/session";

it("a failed author read preserves the CLI diagnostic and next action", () =>
  withSdk(async ({ client, box }) => {
    const cli = runCli(box, ["guide", "author", "does-not-exist"]);
    expect(cli.status).toBe(2);
    expect(cli.stdout).toBe("");
    expect(cli.stderr).toContain("Next:");
    await expect(
      client.readResource({ uri: "stacks://guide/author/does-not-exist" }),
    ).rejects.toMatchObject({ message: `MCP error -32603: ${cli.stderr.trim()}` });
  }));
