import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Cause, Effect, FileSystem, PlatformError } from "effect";
import { afterEach, expect, test } from "vitest";
import { openProject } from "../src/core/scaffold/write";
import { BadInput } from "../src/errors";
import { Invocation } from "../src/services/invocation";
import { quiet, runCli, tempDir } from "./helpers/cli";

const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});

test("a mixed exclusive-write cause reports the defect to a CLI caller", async () => {
  const dir = tempDir();
  dirs.push(dir);
  const root = realpathSync(dir.path);
  const target = join(root, "created.txt");
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fault = FileSystem.make({
      ...fs,
      writeFile: (path, data, options) =>
        path === target
          ? Effect.failCause(
              Cause.combine(
                Cause.fail(
                  PlatformError.systemError({
                    _tag: "AlreadyExists",
                    module: "FileSystem",
                    method: "writeFile",
                    pathOrDescriptor: path,
                  }),
                ),
                Cause.die(new TypeError("injected mixed cause")),
              ),
            )
          : fs.writeFile(path, data, options),
    });
    yield* Effect.scoped(
      Effect.flatMap(openProject(root), (writer) =>
        writer.write("created.txt", new TextEncoder().encode("new")),
      ),
    ).pipe(Effect.provideService(FileSystem.FileSystem, fault));
  });
  const result = await runCli(["--json"], { program, env: quiet });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr).error.tag).toBe("Defect");
});

test("rollback paths are escaped in text errors", async () => {
  const result = await runCli([], {
    program: Effect.gen(function* () {
      yield* (yield* Invocation).rollbackIncomplete("bad\npath");
      return yield* new BadInput({ details: { flag: "limit", value: "bad" } });
    }),
    env: quiet,
  });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("bad\\u000apath");
  expect(result.stderr).not.toContain("bad\npath");
});
