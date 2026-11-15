import { expect, test } from "vitest";
import { outputPath, shippedPath } from "../src/index";

test("a files/ source ships everywhere at its path without the prefix", () => {
  expect(shippedPath("files/src/main.ts")).toEqual({ path: "src/main.ts", condition: null });
});

test("adapter, stack overlay and payload sources ship only for their selection", () => {
  expect(shippedPath("adapters/claude/.claude/settings.json")).toEqual({
    path: ".claude/settings.json",
    condition: { kind: "agent", id: "claude" },
  });
  expect(shippedPath("stacks/react-router/app/posthog.ts")).toEqual({
    path: "app/posthog.ts",
    condition: { kind: "stack", id: "react-router" },
  });
  expect(shippedPath("payloads/none/src/index.ts")).toEqual({
    path: "src/index.ts",
    condition: { kind: "payload", id: "none" },
  });
});

test("the entry's markdown file and paths outside the shipped trees never ship", () => {
  expect(shippedPath("STACK.md")).toBeUndefined();
  expect(shippedPath("files/")).toBeUndefined();
  expect(shippedPath("adapters/claude")).toBeUndefined();
  expect(shippedPath("notes/files/a.ts")).toBeUndefined();
});

test("an output path drops a .tmpl suffix but keeps a file literally named .tmpl", () => {
  expect(outputPath("README.md.tmpl")).toBe("README.md");
  expect(outputPath("docs/guide.md.tmpl")).toBe("docs/guide.md");
  expect(outputPath("templates/.tmpl")).toBe("templates/.tmpl");
  expect(outputPath("src/main.ts")).toBe("src/main.ts");
});
