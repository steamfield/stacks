import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ProgressNotification,
  ProgressNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { ListResult, NewResult, VerifyResult } from "../src/schemas/cli";
import { capture, textContent, withSdk } from "./helpers/session";

// Scaffolding and process cleanup get 30 seconds; no dependency installation is attempted.
it.each([0, "opaque-progress-token"])(
  "the list/new/verify loop keeps diagnostics and forwards progress token %s before its result",
  (token) =>
    withSdk(async ({ client, box, incoming, outgoing }) => {
      const listResult = await client.callTool(
        {
          name: "stacks_list",
          arguments: { group: "stacks" },
        },
        undefined,
        { timeout: 5000 },
      );
      expect(listResult.isError).toBeFalsy();
      const list = await Effect.runPromise(
        Schema.decodeUnknownEffect(ListResult)(JSON.parse(textContent(listResult))),
      );
      expect(list.entries.some((entry) => entry.id === "typescript-mcp")).toBe(true);
      expect(list.entries.every((entry) => entry.kind === "stack")).toBe(true);
      expect(listResult.structuredContent).toEqual(list);

      const dir = join(box.root, "dogfood project");
      const newResult = await client.callTool(
        {
          name: "stacks_new",
          arguments: { stack: "typescript-mcp", dir, preset: "sandbox" },
        },
        undefined,
        { timeout: 5000 },
      );
      expect(newResult.isError).toBeFalsy();
      const created = await Effect.runPromise(
        Schema.decodeUnknownEffect(NewResult)(JSON.parse(textContent(newResult))),
      );
      expect(created.project).toBe(dir);
      expect(created.preset).toBe("sandbox");
      expect(newResult.structuredContent).toEqual(created);
      expect(existsSync(join(dir, ".stacks/manifest.json"))).toBe(true);
      expect(existsSync(join(dir, ".stacks/BRIEF.md"))).toBe(true);

      const progress: ProgressNotification["params"][] = [];
      let completed = false;
      client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
        expect(completed).toBe(false);
        progress.push(notification.params);
      });
      const verifyResult = await client.callTool(
        { name: "stacks_verify", arguments: { dir }, _meta: { progressToken: token } },
        undefined,
        {
          timeout: 10_000,
        },
      );
      completed = true;
      expect(verifyResult.isError).toBeFalsy();
      const raw = JSON.parse(textContent(verifyResult));
      const verified = await Effect.runPromise(Schema.decodeUnknownEffect(VerifyResult)(raw));
      expect(verified.outcome).toBe("failed");
      expect(verified.steps.find((step) => step.name === "install")).toMatchObject({
        status: "failed",
        failureKind: "env",
      });
      for (const step of verified.steps.filter((step) => step.status === "failed"))
        expect(step.failureKind).toBeDefined();
      expect(raw.next).toEqual(expect.any(String));
      expect(verifyResult.structuredContent).toEqual(raw);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.map((notification) => notification.progress)).toEqual(
        progress.map((_, i) => i + 1),
      );
      for (const notification of progress) {
        expect(notification.progressToken).toBe(token);
        expect(notification.total).toBeUndefined();
        expect(notification.message).toEqual(expect.any(String));
      }
      const requests = capture(incoming)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const request = requests.find(
        (frame) => frame.method === "tools/call" && frame.params?.name === "stacks_verify",
      );
      expect(request?.params?._meta?.progressToken).toBe(token);
      const frames = capture(outgoing)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const resultIndex = frames.findIndex((frame) => frame.id === request?.id);
      const progressFrames = frames.filter((frame) => frame.method === "notifications/progress");
      expect(progressFrames.length).toBe(progress.length);
      for (const frame of progressFrames) {
        expect(frame.params.progressToken).toBe(request.params._meta.progressToken);
        expect(frame.params).not.toHaveProperty("total");
        expect(frames.indexOf(frame)).toBeLessThan(resultIndex);
      }
    }),
  30_000,
);
