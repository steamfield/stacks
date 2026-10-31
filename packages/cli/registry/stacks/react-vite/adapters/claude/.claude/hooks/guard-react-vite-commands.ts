// PreToolUse (Bash): deny commands that are wrong for this stack, with the fix.
//
//   bun test                           bun's own test runner; the tests are Vitest (bun run test)
//   --bun on vite / vitest / playwright these run on Node here; --bun swaps in Bun's runtime
//   installing react-router-dom        folded into react-router; import from "react-router"
//   installing @react-router/dev       React Router's framework mode (server rendering, file
//                                      routes); this app is a client-side data router
//
// Commands are read the way bash runs them (see _shell.ts), so a quoted mention (a commit message,
// bun run test -t "bun test") passes.
import { basename } from "node:path";
import { deny, readPayload, text } from "./_lib";
import { type Command, commands } from "./_shell";

const NODE_TOOL = /(^|\/)(vite|vitest|playwright)$/;
const SCRIPTS = new Set([
  "dev",
  "build",
  "preview",
  "test",
  "test:watch",
  "coverage",
  "e2e",
  "check",
]);
const INSTALL = new Set(["add", "install", "i", "a"]);

function reasonFor(cmd: Command): string | undefined {
  const [first = "", ...args] = cmd.argv;
  const name = basename(first);
  if (!["bun", "bunx", "npm", "npx", "pnpm", "yarn"].includes(name)) return undefined;
  const bun = name === "bun" || name === "bunx";
  if (
    bun &&
    args.includes("--bun") &&
    (args.some((a) => NODE_TOOL.test(a)) ||
      (args.includes("run") && args.some((a) => SCRIPTS.has(a))))
  ) {
    return "Vite, Vitest and Playwright run on Node in this project. Drop --bun (bun run dev / bun run test / bun run e2e).";
  }
  if (name === "bun" && args[0] === "test") {
    return 'bun test is Bun\'s own test runner; the tests here are Vitest. Use bun run test (add a file path or -t "<name>" to scope it).';
  }
  if (name !== "bunx" && name !== "npx" && INSTALL.has(args[0] ?? "")) {
    const packages = args.slice(1).map((a) => a.replace(/(.)@[^/]*$/, "$1"));
    if (packages.includes("react-router-dom")) {
      return 'react-router-dom was folded into react-router. Import from "react-router" (RouterProvider too) instead of installing it.';
    }
    if (packages.includes("@react-router/dev")) {
      return "@react-router/dev is React Router's framework mode (server rendering, file routes). This app is a client-side SPA: add routes to src/app/routes.tsx.";
    }
  }
  return undefined;
}

const command = text(readPayload()?.tool_input?.command);
const reason = command
  ? commands(command)
      .map(reasonFor)
      .find((r) => r !== undefined)
  : undefined;
if (reason) deny(`BLOCKED: ${reason}`);
