import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { runScheduled, scheduled } from "./scheduled";

test("invokes the scheduled slot with Workers bindings and controller", async () => {
  await expect(scheduled(createScheduledController(), env)).resolves.toBeUndefined();
});

test("propagates rejected scheduled work to the caller", async () => {
  await expect(runScheduled(env, Number.NaN)).rejects.toBeInstanceOf(RangeError);
  await expect(runScheduled({ GREETING: "" }, 0)).rejects.toBeInstanceOf(Response);
  await expect(
    scheduled(createScheduledController(), { ...env, GREETING: "" }),
  ).rejects.toBeInstanceOf(Response);
});
