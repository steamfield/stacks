import { afterEach, expect, test, vi } from "vitest";
import { appTransport } from "./app-transport";

afterEach(() => vi.unstubAllEnvs());

test("browser defaults to fixtures and invalid transport configuration fails", async () => {
  vi.stubEnv("VITE_TRANSPORT", "mock");
  const transport = appTransport();
  expect((await transport.appInfo()).status).toBe("ok");
  expect(transport.windowLabel).toBe("main");
  vi.stubEnv("VITE_TRANSPORT", "typo");
  expect(() => appTransport()).toThrow("VITE_TRANSPORT must be mock or native");
});
