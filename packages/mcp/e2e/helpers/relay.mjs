import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

// A byte-transparent relay lets the official SDK own transport while tests inspect raw frames.
const [server, incoming, outgoing, stderr] = process.argv.slice(2);
if (!server || !incoming || !outgoing) throw new Error("Expected server and two capture paths");
const child = spawn(process.execPath, [server], {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
process.stdin.on("data", (chunk) => appendFileSync(incoming, chunk));
child.stdout.on("data", (chunk) => appendFileSync(outgoing, chunk));
if (stderr) child.stderr.on("data", (chunk) => appendFileSync(stderr, chunk));
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdin.on("error", (error) => {
  if (error.code !== "EPIPE") throw error;
});
let killTimer;
let closed = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    child.kill(signal);
    // The SDK kills the relay two seconds after SIGTERM; reap its child first.
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
  });
process.once("exit", () => {
  if (!closed) child.kill("SIGKILL");
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  closed = true;
  clearTimeout(killTimer);
  process.exitCode = code ?? 1;
  process.stdin.destroy();
});
