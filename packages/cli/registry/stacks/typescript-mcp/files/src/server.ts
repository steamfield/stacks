/**
 * Builds a fresh MCP server and registers its tools for each connection. The stdio entry and
 * in-memory tests supply the transport separately.
 */

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
