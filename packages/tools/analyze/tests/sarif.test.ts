import { describe, expect, test } from "vitest";
import { countResults, sarifSchemaUri, validateSarif } from "../src/schemas/sarif";

describe("sarif validator", () => {
  test("accepts a minimal 2.1.0 log", () => {
    const result = validateSarif({
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "t" } }, results: [] }],
    });
    expect(result.ok).toBe(true);
  });

  test("rejects a version other than 2.1.0 naming the version", () => {
    const result = validateSarif({ version: "2.0.0", runs: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.version).toBe("2.0.0");
      expect(result.reason).toContain("2.0.0");
    }
  });

  test("rejects a missing version", () => {
    const result = validateSarif({ runs: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("version");
    }
  });

  test("rejects a non-object log with a reason instead of throwing", () => {
    const result = validateSarif("not an object");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("object");
    }
  });

  test("rejects a log without a runs array", () => {
    const result = validateSarif({ version: "2.1.0", runs: "nope" });
    expect(result.ok).toBe(false);
  });

  test("counts results across runs", () => {
    const result = validateSarif({
      version: "2.1.0",
      runs: [{ results: [{ ruleId: "a" }, { ruleId: "b" }] }, { results: [{ ruleId: "c" }] }, {}],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(countResults(result.log)).toBe(3);
    }
  });

  test("exposes the standard schema uri", () => {
    expect(sarifSchemaUri()).toContain("sarif");
  });
});
