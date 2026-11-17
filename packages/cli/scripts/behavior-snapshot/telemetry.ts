import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capture, environment, normalizedFiles, type Runner, readTree, writeJson } from "./capture";
import { seedRegistry } from "./cases";
import { normalizeFor, normalizeTelemetryBody } from "./normalize";

const commands = [
  { id: "1-new", args: ["new", "snapshot-fixture", "app", "--no-launch"] },
  { id: "2-verify", args: ["verify"] },
  { id: "3-failure", args: ["new", "snapshot-missing", "--no-launch"] },
  { id: "4-verify", args: ["verify"] },
];

export async function telemetryPass(runner: Runner, out: string, scratch: string) {
  const requests: { method: string; path: string; body: string }[] = [];
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname + url.search,
        body: await request.text(),
      });
      return Response.json({ rejected: [] }, { status: 202 });
    },
  });
  const telemetryUrl = sink.url.origin;
  try {
    for (const variant of ["notice-accepted", "notice-unseen"]) {
      const base = join(scratch, "telemetry", variant);
      const home = join(base, "home");
      const workspace = join(base, "workspace");
      const env = environment(home, runner.node, telemetryUrl);
      const normalize = normalizeFor({ scratch, packageRoot: runner.packageRoot, telemetryUrl });
      const telemetry = join(env.XDG_STATE_HOME, "stacks", "telemetry");
      mkdirSync(workspace, { recursive: true });
      seedRegistry(home);
      if (variant === "notice-accepted") {
        writeJson(join(telemetry, "notice.json"), {
          noticeShownAt: "2020-01-01T00:00:00.000Z",
          noticeVersion: 2,
        });
      }
      for (const { id, args } of commands) {
        const destination = join(out, "telemetry", variant, id);
        const start = requests.length;
        await capture({
          runner,
          out: destination,
          args,
          audience: "json",
          cwd: args[0] === "verify" ? join(workspace, "app") : workspace,
          workspace,
          env,
          normalize,
        });
        writeJson(
          join(destination, "requests.json"),
          requests.slice(start).map((request) => ({
            ...request,
            path: normalize(request.path),
            body: normalizeTelemetryBody(request.body, normalize),
          })),
        );
        writeJson(
          join(destination, "telemetry-files.json"),
          normalizedFiles(readTree(telemetry), normalize),
        );
      }
    }
  } finally {
    await sink.stop(true);
  }
  return commands.length * 2;
}
