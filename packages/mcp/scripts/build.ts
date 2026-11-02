import { chmodSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
const result = await Bun.build({
  entrypoints: ["src/server.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  banner: "#!/usr/bin/env node",
});
if (!result.success) throw new AggregateError(result.logs, "Server build failed");
chmodSync("dist/server.js", 0o755);
