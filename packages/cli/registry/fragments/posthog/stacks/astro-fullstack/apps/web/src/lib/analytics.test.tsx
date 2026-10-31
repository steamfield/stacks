// @vitest-environment happy-dom
// A .tsx name so the web project's src/**/*.test.tsx include picks it up.
import type { PostHog } from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as analytics from "./analytics";
import { Events } from "./events";

type Init = (key: string, config: { loaded: (p: PostHog) => void }) => void;

// A stand-in for the SDK at its boundary: records calls, fires loaded on demand.
function fakeSdk() {
  const calls: unknown[][] = [];
  let loaded: (() => void) | undefined;
  const instance = {
    capture: (...args: unknown[]) => calls.push(["capture", ...args]),
    identify: (...args: unknown[]) => calls.push(["identify", ...args]),
    reset: () => calls.push(["reset"]),
  } as unknown as PostHog;
  const init: Init = (_key, config) => {
    loaded = () => config.loaded(instance);
  };
  const sdk = { ...instance, init } as unknown as PostHog;
  const load = vi.fn(async () => ({ default: sdk }));
  return { calls, load, fireLoaded: () => loaded?.() };
}

afterEach(() => {
  analytics.resetAnalyticsForTests();
  vi.restoreAllMocks();
});

describe("without a key", () => {
  it("never loads the SDK and every call is a silent no-op", async () => {
    const sdk = fakeSdk();
    const warn = vi.spyOn(console, "warn");
    await analytics.initAnalytics({ key: "" }, sdk.load);
    analytics.track(Events.exampleViewed);
    analytics.identify("user_1");
    analytics.reset();
    expect(sdk.load).not.toHaveBeenCalled();
    expect(sdk.calls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("with a key", () => {
  it("replays calls made before init in order", async () => {
    const sdk = fakeSdk();
    const init = analytics.initAnalytics({ key: "phc_test" }, sdk.load);
    analytics.track(Events.exampleViewed, { position: 1 });
    analytics.identify("user_1");
    await init;
    expect(sdk.calls).toEqual([]);
    sdk.fireLoaded();
    analytics.track(Events.exampleViewed, { position: 2 });
    analytics.reset();
    expect(sdk.calls).toEqual([
      ["capture", "example_viewed", { position: 1 }],
      ["identify", "user_1", undefined],
      ["capture", "example_viewed", { position: 2 }],
      ["reset"],
    ]);
  });

  it("keeps the first 50 calls made before init and drops the rest", async () => {
    const sdk = fakeSdk();
    const init = analytics.initAnalytics({ key: "phc_test" }, sdk.load);
    for (let i = 0; i < 60; i++) analytics.track(Events.exampleViewed, { i });
    await init;
    sdk.fireLoaded();
    expect(sdk.calls).toHaveLength(50);
    expect(sdk.calls.at(-1)).toEqual(["capture", "example_viewed", { i: 49 }]);
  });

  it("initializes once across repeated calls", async () => {
    const sdk = fakeSdk();
    await Promise.all([
      analytics.initAnalytics({ key: "phc_test" }, sdk.load),
      analytics.initAnalytics({ key: "phc_test" }, sdk.load),
    ]);
    expect(sdk.load).toHaveBeenCalledTimes(1);
  });

  it("applies its config to the installed posthog-js", async () => {
    // The real SDK, kept offline: before_send sees each event and drops it.
    const { default: posthog } = await import("posthog-js");
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const realInit = posthog.init.bind(posthog);
    const offlineInit: typeof posthog.init = (key, config) =>
      realInit(key, {
        ...config,
        // The test DOM's user agent counts as a bot, and posthog-js drops
        // bot events before before_send. Without this, nothing is seen.
        opt_out_useragent_filter: true,
        advanced_disable_flags: true,
        before_send: (event) => {
          if (event) seen.push(event.event);
          return null;
        },
      });
    const load = async () => {
      posthog.init = offlineInit;
      return { default: posthog };
    };
    const config = { key: "phc_test", host: "http://127.0.0.1:9" };
    await analytics.initAnalytics(config, load);
    analytics.track(Events.exampleViewed);
    expect(seen).toContain("example_viewed");
    expect(posthog.config.autocapture).toBe(false);
    expect(posthog.config.capture_pageview).toBe("history_change");
    expect(posthog.config.cookieless_mode).toBe("always");
    expect(posthog.config.disable_session_recording).toBe(true);
  });
});
