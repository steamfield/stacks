import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { McpClient, McpProtocol } from "effect/ai";
import { ChildProcess } from "effect/process";
import { describe, expect, it } from "vitest";
import { capture, relayPath, sandbox, serverPath } from "./helpers/session";

describe("Effect client protocol eras", () => {
  for (const protocol of [McpProtocol.v2025_11_25, McpProtocol.v2026_07_28]) {
    it(`exchanges tools and resources using the actual ${protocol.protocolVersion} wire lifecycle`, async () => {
      const box = sandbox();
      const incoming = join(box.root, "incoming.jsonl");
      const outgoing = join(box.root, "outgoing.jsonl");
      const stderr = join(box.root, "stderr");
      const command = ChildProcess.make(
        process.execPath,
        [relayPath, serverPath, incoming, outgoing, stderr],
        { cwd: box.root, env: box.env, extendEnv: false },
      );
      const layer = McpClient.layerStdio({
        name: "acceptance-effect",
        version: "1",
        command,
        protocol,
        timeout: "5 seconds",
      }).pipe(Layer.provide(NodeServices.layer));
      const program = Effect.gen(function* () {
        const client = yield* McpClient.McpClient;
        expect(client.protocolVersion).toBe(protocol.protocolVersion);
        const tools = yield* client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
          "stacks_list",
          "stacks_new",
          "stacks_verify",
        ]);
        const list = tools.find((tool) => tool.name === "stacks_list");
        if (list === undefined) throw new Error("No stacks_list tool");
        const result = yield* client.callTool(
          { tool: list, arguments: {} },
          { timeout: "5 seconds" },
        );
        expect(result.isError).toBeFalsy();
        const resources = yield* client.listResources();
        expect(resources.map((resource) => resource.uri)).toContain("stacks://guide");
        const guide = yield* client.readResource(
          { uri: "stacks://guide" },
          { timeout: "5 seconds" },
        );
        expect(guide.contents).toHaveLength(1);
      }).pipe(Effect.provide(layer), Effect.scoped);
      try {
        await Effect.runPromise(program);
        const sent = capture(incoming)
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const received = capture(outgoing)
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        if (protocol.protocolVersion === "2025-11-25") {
          const initialize = sent.find((frame) => frame.method === "initialize");
          expect(initialize?.params.protocolVersion).toBe(protocol.protocolVersion);
          expect(
            received.find((frame) => frame.id === initialize?.id)?.result.protocolVersion,
          ).toBe(protocol.protocolVersion);
          expect(sent.some((frame) => frame.method === "notifications/initialized")).toBe(true);
        } else {
          expect(sent.some((frame) => frame.method === "initialize")).toBe(false);
          const discover = sent.find((frame) => frame.method === "server/discover");
          expect(discover).toBeDefined();
          expect(
            received.find((frame) => frame.id === discover?.id)?.result._meta?.[
              "io.modelcontextprotocol/serverInfo"
            ],
          ).toBeDefined();
          for (const frame of sent.filter((frame) => "id" in frame)) {
            expect(frame.params?._meta?.["io.modelcontextprotocol/protocolVersion"]).toBe(
              protocol.protocolVersion,
            );
            expect(
              frame.params?._meta?.["io.modelcontextprotocol/clientCapabilities"],
            ).toBeDefined();
          }
        }
      } catch (error) {
        console.error(`Server stderr:\n${capture(stderr)}`);
        throw error;
      }
    });
  }
});
