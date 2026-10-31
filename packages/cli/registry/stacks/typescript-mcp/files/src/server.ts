// Builds the MCP server and registers every tool. No transport here: src/index.ts serves it over
// stdio, and the tests connect an in-memory client to it.
import { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "./tools/deps.ts";
import { registerReadFile } from "./tools/read-file.ts";

export type ServerInfo = { name: string; version: string };

const INSTRUCTIONS =
  "Reads text files from one root directory on the user's machine. Paths are relative to that root.";

/** A fresh server with every tool registered. Called once per connection, so keep it cheap. */
export function createServer(info: ServerInfo, deps: ToolDeps): McpServer {
  const server = new McpServer(info, { instructions: INSTRUCTIONS });
  registerReadFile(server, deps);
  return server;
}
