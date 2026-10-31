import { describe, expect, it } from "vitest";
import { denyReason, edit, REPO, runHook, write } from "../helpers/hooks";

const REASON = "is app code, which Nuxt can bundle into the browser";
const vue = (body: string) => `<script setup lang="ts">\n${body}</script>\n`;

const run = (relPath: string, content: string) =>
  runHook("PreToolUse", "guard-server-imports", write(`${REPO}/${relPath}`, content));

describe.concurrent("guard-server-imports denies", () => {
  it.each([
    [
      "a component importing by the root alias",
      "app/components/NoteList.vue",
      vue('import { listNotes } from "~~/server/utils/notes";\n'),
    ],
    [
      "a page importing by the other root alias",
      "app/pages/index.vue",
      vue("import { addNote } from '@@/server/utils/notes';\n"),
    ],
    [
      "a composable importing by relative path",
      "app/composables/useNotes.ts",
      'import { listNotes } from "../../server/utils/notes";\n',
    ],
    [
      "a dynamic import",
      "app/plugins/notes.ts",
      'const mod = await import("~~/server/utils/config");\n',
    ],
    ["a re-export", "app/utils/notes.ts", 'export { addNote } from "~~/server/utils/notes";\n'],
    [
      "a Nitro alias",
      "app/components/Health.vue",
      vue('import handler from "#server/api/health.get";\n'),
    ],
  ])("%s", async (_name, path, content) => {
    expect(denyReason(await run(path, content))).toContain(REASON);
  });

  it("an Edit adding the import", async () => {
    const result = await runHook(
      "PreToolUse",
      "guard-server-imports",
      edit(`${REPO}/app/pages/index.vue`, 'import { listNotes } from "~~/server/utils/notes";'),
    );
    expect(denyReason(result)).toContain(REASON);
  });
});

describe.concurrent("guard-server-imports allows", () => {
  it.each([
    [
      "the shared schema",
      "app/components/AddNoteForm.vue",
      vue('import type { FieldErrors } from "#shared/schemas/note";\n'),
    ],
    [
      "a server route importing server code",
      "server/api/notes.get.ts",
      'import { listNotes } from "../utils/notes";\n',
    ],
    [
      "a fetch of the server route",
      "app/pages/index.vue",
      vue('const { data } = await useFetch("/api/notes");\n'),
    ],
    [
      "a mention in a comment that isn't an import",
      "app/pages/index.vue",
      vue("// data comes from server/api/notes.get.ts\n"),
    ],
    [
      "a component whose name starts with server",
      "app/components/Status.vue",
      vue('import ServerStatus from "./ServerStatus.vue";\n'),
    ],
  ])("%s", async (_name, path, content) => {
    const result = await run(path, content);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("files outside the project", async () => {
    const result = await runHook(
      "PreToolUse",
      "guard-server-imports",
      write("/somewhere/else/app/pages/index.vue", vue('import x from "~~/server/x";\n')),
    );
    expect(result.stdout).toBe("");
  });
});
