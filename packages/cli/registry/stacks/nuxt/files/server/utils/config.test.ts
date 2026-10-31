import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./config";

describe("parseServerConfig", () => {
  it("fills defaults", () => {
    expect(parseServerConfig({ public: {} })).toEqual({
      logLevel: "info",
      public: { appTitle: "Notes" },
    });
  });

  it("trims the title and keeps a valid level", () => {
    expect(parseServerConfig({ logLevel: "debug", public: { appTitle: "  Ideas " } })).toEqual({
      logLevel: "debug",
      public: { appTitle: "Ideas" },
    });
  });

  it("names the bad keys without echoing their values", () => {
    expect(() =>
      parseServerConfig({ logLevel: "secret-value", public: { appTitle: " " } }),
    ).toThrow(/^Invalid runtime config: logLevel, public\.appTitle$/);
  });
});
