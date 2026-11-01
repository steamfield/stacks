import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ToolError } from "../errors.ts";
import type { ToolDeps } from "./deps.ts";
import { runTool } from "./run.ts";

export const ReadFileInput = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(1024)
    .describe("Path of the file relative to the server's root directory, such as notes/todo.md"),
});

export const ReadFileOutput = z.object({
  path: z.string().describe("The path as given, relative to the root"),
  bytes: z.number().int().nonnegative().describe("Size of the file in bytes"),
  text: z.string().describe("The whole file as UTF-8 text"),
});
export type ReadFileOutput = z.infer<typeof ReadFileOutput>;

/** Rejects absolute paths and `..` segments before touching the file system. */
function checkShape(path: string): void {
  const segments = path.split(/[\\/]/);
  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path) || segments.includes("..")) {
    throw new ToolError("invalid_path");
  }
}

/** The real path of `path` under `root`, refusing anything a symbolic link takes outside it. */
async function resolveInside(root: string, path: string): Promise<string> {
  const realRoot = await realpath(root);
  const real = await realpath(resolve(realRoot, path)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new ToolError("not_found");
    throw error;
  });
  const rel = relative(realRoot, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError("outside_root");
  }
  return real;
}

/** Reads one UTF-8 text file under `root`. Every expected failure is a ToolError. */
export async function readFileUnderRoot(
  root: string,
  path: string,
  maxBytes: number,
): Promise<ReadFileOutput> {
  checkShape(path);
  const real = await resolveInside(root, path);
  const stats = await stat(real);
  if (!stats.isFile()) throw new ToolError("not_a_file");
  if (stats.size > maxBytes) throw new ToolError("too_large");
  const bytes = await readFile(real);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ToolError("not_text");
  }
  return { path, bytes: bytes.byteLength, text };
}

export function registerReadFile(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "read_file",
    {
      title: "Read a text file",
      description:
        "Read one UTF-8 text file from the server's root directory and return its contents. Use it when you need the text of a file whose path you know; paths are relative to the root.",
      inputSchema: ReadFileInput,
      outputSchema: ReadFileOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ path }) =>
      runTool(deps.logger, "read_file", () =>
        readFileUnderRoot(deps.config.root, path, deps.config.maxFileBytes),
      ),
  );
}
