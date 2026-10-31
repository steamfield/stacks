import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { PackageInfo } from "../src/schemas/package";

const metadata = Schema.decodeUnknownSync(PackageInfo)(
  JSON.parse(await readFile("package.json", "utf8")),
);

const binary = resolve("dist", metadata.name);
test("compiled output, config precedence, log records, errors, and no dotenv autoload", async () => {
  const home = await mkdtemp(join(tmpdir(), "cli-binary-"));
  const prefix = metadata.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  try {
    const config = join(home, "config", metadata.name);
    const log = join(home, "cli.jsonl");
    await mkdir(config, { recursive: true });
    await writeFile(
      join(config, "config.json"),
      JSON.stringify({ logLevel: "debug", greeting: "file" }),
    );
    await writeFile(join(home, ".env"), `LOG_LEVEL=none\n${prefix}_GREETING=dotenv\n`);
    await writeFile(join(home, "bunfig.toml"), "deliberately invalid [");
    const run = async (args: string[], extra: Record<string, string> = {}) => {
      const child = Bun.spawn([binary, ...args], {
        cwd: home,
        env: {
          HOME: home,
          XDG_CONFIG_HOME: join(home, "config"),
          NO_COLOR: "1",
          [`${prefix}_LOG_FILE`]: log,
          ...extra,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { status, stdout, stderr };
    };
    const result = await run(["doctor", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: metadata.name,
      version: metadata.version ?? "dev",
      compiled: true,
      greeting: "file",
      configError: null,
    });
    const records = result.stderr
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ level: "debug", msg: "configuration checked" });
    expect(records[1]).toMatchObject({ msg: "command", outcome: "success", exitCode: 0 });
    expect(
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(records);
    const overridden = await run(["doctor", "--json"], {
      LOG_LEVEL: "none",
      [`${prefix}_GREETING`]: "env",
    });
    expect(overridden.status).toBe(0);
    expect(overridden.stderr).toBe("");
    expect(JSON.parse(overridden.stdout)).toMatchObject({ greeting: "env" });
    const bad = await run(["doctor", "--unknown", "--json"], { LOG_LEVEL: "none" });
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe("");
    expect(JSON.parse(bad.stderr)).toMatchObject({ error: { tag: "Usage", retryable: false } });
    await writeFile(join(config, "config.json"), "broken");
    for (const args of [["--help"], ["--version"], ["doctor"]]) {
      const output = await run(args, { LOG_LEVEL: "none" });
      expect(output.status).toBe(0);
      expect(output.stderr).toBe("");
      expect(output.stdout).toContain(
        args[0] === "--version" ? (metadata.version ?? "dev") : metadata.name,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
