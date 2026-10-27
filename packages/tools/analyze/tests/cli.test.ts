import { describe, expect, test } from "vitest";
import { helpText, parse } from "../src/cli";

describe("cli parsing", () => {
  test("parses a positional target", () => {
    const result = parse(["some/path"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.target).toBe("some/path");
      expect(result.parsed.sarif).toEqual([]);
    }
  });

  test("parses repeatable flags", () => {
    const result = parse([
      "path",
      "--sarif",
      "a.sarif",
      "--sarif",
      "b.sarif",
      "--tool",
      "semgrep",
      "--tool",
      "ruff",
      "--exclude",
      "dist/**",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.sarif).toEqual(["a.sarif", "b.sarif"]);
      expect(result.parsed.tool).toEqual(["semgrep", "ruff"]);
      expect(result.parsed.exclude).toEqual(["dist/**"]);
    }
  });

  test("parses --out and --label", () => {
    const result = parse(["path", "--out", "report.sarif", "--label", "demo"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.out).toBe("report.sarif");
      expect(result.parsed.label).toBe("demo");
    }
  });

  test("an unknown flag is a usage error", () => {
    const result = parse(["path", "--nope"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("--nope");
    }
  });

  test("a value flag without a value is a usage error", () => {
    const result = parse(["path", "--out"]);
    expect(result.ok).toBe(false);
  });

  test("a missing target is a usage error", () => {
    const result = parse([]);
    expect(result.ok).toBe(false);
  });

  test("help and version are parsed without a target", () => {
    expect(parse(["--help"]).ok).toBe(true);
    expect(parse(["--version"]).ok).toBe(true);
  });

  test("help text mentions the exit codes", () => {
    const text = helpText();
    expect(text).toContain("--sarif");
    expect(text).toContain("Exit codes");
  });
});
