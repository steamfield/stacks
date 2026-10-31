// scripts/delegate.sh against a fake `codex` (CODEX_BIN) in a throwaway repo with a linked
// worktree: what it refuses, the flags it passes Codex, and how it judges and digests a run.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO } from "../helpers/hooks";

const SCRIPT = join(REPO, "scripts/delegate.sh");

// Records its argv, writes one file into its cwd and reports a completed (or failed) turn. With
// FAKE_HANDOFF set, a resume is the timeout hand-off: its argv goes to $FAKE_ARGS.handoff and it
// writes a hand-off (written) or runs until signalled (hang). The hang modes exit on TERM.
const FAKE_CODEX = `#!/usr/bin/env bash
linger() { trap 'kill "$s" 2>/dev/null; exit 143' TERM; sleep 30 & s=$!; wait "$s"; }
args_file="$FAKE_ARGS"
[ "$1 $2" = "exec resume" ] && [ -n "$FAKE_HANDOFF" ] && args_file="$FAKE_ARGS.handoff"
printf '%s\\n' "$@" > "$args_file"
printf '%s\\n' "\${DELEGATE_MODEL-unset}" > "$FAKE_ARGS.model"
while [ $# -gt 0 ]; do
  case "$1" in
    --output-last-message) last="$2"; shift ;;
  esac
  shift
done
if [ "$args_file" != "$FAKE_ARGS" ]; then
  [ "$FAKE_HANDOFF" = hang ] && linger
  echo '{"type":"turn.completed"}'
  echo "Hand-off: half done" > "$last"
  exit 0
fi
echo written > src.txt
[ "$FAKE_MODE" = silent-hang ] && linger
echo '{"type":"thread.started","thread_id":"thread-1"}'
[ "$FAKE_MODE" = hang ] && linger
echo '{"type":"item.completed","item":{"type":"command_execution","command":"bun run test","exit_code":0}}'
if [ "$FAKE_MODE" = warned ]; then
  echo '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"hooks may run without review"}}'
fi
if [ "$FAKE_MODE" = fail ]; then
  echo '{"type":"turn.failed","error":{"message":"boom"}}'
elif [ "$FAKE_MODE" = capacity ]; then
  echo '{"type":"turn.failed","error":{"message":"Selected model is at capacity. Please try a different model."}}'
  exit 1
else
  echo '{"type":"turn.completed"}'
  echo "Changed src.txt" > "$last"
fi
`;

let root: string;
let main: string;
let worktree: string;
let contract: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: root },
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "delegate-"));
  main = join(root, "main");
  worktree = join(root, "wt");
  mkdirSync(main);
  git(main, "init", "-q");
  writeFileSync(join(main, "README.md"), "x\n");
  git(main, "add", ".");
  git(main, "commit", "-q", "-m", "init");
  git(main, "worktree", "add", "-q", worktree, "-b", "delegate/t");
  mkdirSync(join(worktree, "node_modules"));
  writeFileSync(join(worktree, ".gitignore"), "node_modules/\n");
  git(worktree, "add", ".gitignore");
  git(worktree, "commit", "-q", "-m", "ignore");
  writeFileSync(join(root, "codex"), FAKE_CODEX);
  chmodSync(join(root, "codex"), 0o755);
  contract = join(root, "contract.md");
  writeFileSync(contract, "Do the thing.\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      CODEX_BIN: join(root, "codex"),
      FAKE_ARGS: join(root, "args.txt"),
      DELEGATE_LOG_ROOT: join(root, "logs"),
      ...env,
    },
  });

describe("delegate.sh", () => {
  it("refuses the main checkout", () => {
    const result = run([contract, "--worktree", main]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refusing to run a delegate in the main checkout");
  });

  it("refuses a worktree with a package.json but no node_modules", () => {
    rmSync(join(worktree, "node_modules"), { recursive: true });
    writeFileSync(join(worktree, "package.json"), "{}\n");
    const result = run([contract, "--worktree", worktree]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no node_modules");
  });

  it("runs in a worktree with nothing to install yet", () => {
    rmSync(join(worktree, "node_modules"), { recursive: true });
    const result = run([contract, "--worktree", worktree, "--write"]);
    expect(result.status, result.stderr).toBe(0);
  });

  it("runs Codex unsandboxed on sol 6.1 at high effort in fast mode and digests a completed turn", () => {
    const result = run([contract, "--worktree", worktree, "--write"]);
    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(join(root, "args.txt"), "utf8").split("\n");
    expect(args).toEqual(
      expect.arrayContaining([
        'sandbox_mode="danger-full-access"',
        "gpt-6.1-sol",
        'model_reasoning_effort="high"',
        'service_tier="priority"',
        'approval_policy="never"',
      ]),
    );
    expect(result.stdout).toContain("delegate:  codex gpt-6.1-sol (high, priority, write)");
    expect(args).not.toContain("--ephemeral");
    expect(args.join("\n")).toContain("Do the thing.");
    expect(result.stdout).toContain("result:    success - turn completed");
    expect(result.stdout).toContain("session:   thread-1");
    expect(result.stdout).toContain("  [0] bun run test");
    expect(result.stdout).toContain("  ?? src.txt");
    expect(result.stdout).toContain("  Changed src.txt");
  });

  it("takes the service tier from DELEGATE_SERVICE_TIER", () => {
    const result = run([contract, "--worktree", worktree, "--write"], {
      DELEGATE_SERVICE_TIER: "default",
    });
    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(join(root, "args.txt"), "utf8").split("\n");
    expect(args).toContain('service_tier="default"');
    expect(args).not.toContain('service_tier="priority"');
  });

  it("lists changed paths outside the contract's May change entries", () => {
    writeFileSync(
      contract,
      "Do the thing.\n\n## Scope\n\n- May change: `lib/` (new modules),\n  `README.md`.\n- Must not change: `src.txt`.\n",
    );
    const result = run([contract, "--worktree", worktree, "--write"]);
    expect(result.stdout).toContain("outside the contract's May change:\n  src.txt\n");
  });

  it("accepts paths under a May change directory or ending in a package-relative entry", () => {
    writeFileSync(contract, "Do the thing.\n\n- May change: `docs/`, `cli/src.txt`, `src.txt`.\n");
    const result = run([contract, "--worktree", worktree, "--write"]);
    expect(result.stdout).toContain("outside the contract's May change:\n  (none)\n");
  });

  it("says so when the contract has no May change entry", () => {
    const result = run([contract, "--worktree", worktree, "--write"]);
    expect(result.stdout).toContain(
      "outside the contract's May change:\n  (no May change entry)\n",
    );
  });

  describe("the default model", () => {
    const model = (slug: string, visibility = "list") => ({ slug, visibility });
    const cache = (models: unknown) => {
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(
        join(root, ".codex", "models_cache.json"),
        typeof models === "string" ? models : JSON.stringify({ models }),
      );
    };
    const chosen = (env: Record<string, string> = {}) => {
      const result = run([contract, "--worktree", worktree, "--write"], env);
      expect(result.status, result.stderr).toBe(0);
      const args = readFileSync(join(root, "args.txt"), "utf8").split("\n");
      const exported = readFileSync(join(root, "args.txt.model"), "utf8").trim();
      return { args, exported, stdout: result.stdout };
    };

    it("is the newest sol model Codex lists, and Codex's commands see it", () => {
      cache([
        model("gpt-6.1-sol"),
        model("gpt-6.10-sol"),
        model("gpt-6.2-sol"),
        model("gpt-6-sol"),
      ]);
      const { args, exported, stdout } = chosen();
      expect(args).toContain("gpt-6.10-sol");
      expect(exported).toBe("gpt-6.10-sol");
      expect(stdout).toContain("delegate:  codex gpt-6.10-sol (");
    });

    it("ignores hidden models, variants and other families", () => {
      cache([
        model("gpt-6.1-sol"),
        model("gpt-7-sol", "hide"),
        model("gpt-7-sol-mini"),
        model("gpt-7-terra"),
        model("codex-auto-review"),
      ]);
      expect(chosen().exported).toBe("gpt-6.1-sol");
    });

    it("falls back to the pinned model without a usable cache", () => {
      expect(chosen().exported).toBe("gpt-6.1-sol");
      cache("not json");
      expect(chosen().exported).toBe("gpt-6.1-sol");
      cache([model("gpt-7-terra")]);
      expect(chosen().exported).toBe("gpt-6.1-sol");
    });

    it("reads the cache under CODEX_HOME when it is set", () => {
      const home = join(root, "codex-home");
      mkdirSync(home);
      writeFileSync(
        join(home, "models_cache.json"),
        JSON.stringify({ models: [model("gpt-8-sol")] }),
      );
      expect(chosen({ CODEX_HOME: home }).exported).toBe("gpt-8-sol");
    });

    it("yields to DELEGATE_MODEL", () => {
      cache([model("gpt-9-sol")]);
      const { args, exported } = chosen({ DELEGATE_MODEL: "gpt-6-sol" });
      expect(args).toContain("gpt-6-sol");
      expect(exported).toBe("gpt-6-sol");
    });
  });

  it("is read-only without --write and takes the model from the environment", () => {
    run([contract, "--worktree", worktree], { DELEGATE_MODEL: "gpt-6-sol" });
    const args = readFileSync(join(root, "args.txt"), "utf8").split("\n");
    expect(args).toEqual(expect.arrayContaining(['sandbox_mode="read-only"', "gpt-6-sol"]));
  });

  it("resumes a session with the contract as the follow-up and no second preamble", () => {
    const result = run([contract, "--worktree", worktree, "--write", "--resume", "thread-1"]);
    expect(result.status, result.stderr).toBe(0);
    const args = readFileSync(join(root, "args.txt"), "utf8").split("\n");
    expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(args).toContain("thread-1");
    expect(args.join("\n")).toContain("Do the thing.");
    expect(args.join("\n")).not.toContain("orchestrator");
  });

  it("fails on a failed turn even when codex exits 0", () => {
    const result = run([contract, "--worktree", worktree, "--write"], { FAKE_MODE: "fail" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("result:    failure - turn failed");
  });

  it("succeeds on a completed turn that carries an error item, such as the hook-trust warning", () => {
    const result = run([contract, "--worktree", worktree, "--write"], { FAKE_MODE: "warned" });
    expect(result.stdout).toContain("result:    success - turn completed");
    expect(result.status).toBe(0);
  });

  it("names a turn's failure when codex exits nonzero, and says a capacity failure can resume", () => {
    const result = run([contract, "--worktree", worktree, "--write"], { FAKE_MODE: "capacity" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("result:    failure - turn failed");
    expect(result.stdout).toContain("at capacity");
    expect(result.stdout).toContain("transient: resume thread-1 with a short 'continue' follow-up");
  });

  describe("on a timeout", () => {
    const capped = { DELEGATE_TIMEOUT_SECS: "1", DELEGATE_HANDOFF_SECS: "1", FAKE_MODE: "hang" };
    const handoffArgs = () => join(root, "args.txt.handoff");

    it("resumes the session read-only once for a hand-off and digests it", () => {
      const result = run([contract, "--worktree", worktree, "--write"], {
        ...capped,
        FAKE_HANDOFF: "written",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("result:    failure - timed out after 1s (hand-off written)");
      expect(result.stdout).toContain("session:   thread-1");
      expect(result.stdout).toContain("  Hand-off: half done");
      const args = readFileSync(handoffArgs(), "utf8").split("\n");
      expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
      expect(args).toEqual(expect.arrayContaining(['sandbox_mode="read-only"', "thread-1"]));
      expect(args).not.toContain('sandbox_mode="danger-full-access"');
    }, 30_000);

    it("reports no hand-off when the hand-off turn hits its own cap", () => {
      const started = Date.now();
      const result = run([contract, "--worktree", worktree, "--write"], {
        ...capped,
        FAKE_HANDOFF: "hang",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("result:    failure - timed out after 1s (no hand-off)");
      expect(existsSync(handoffArgs())).toBe(true);
      // Both caps plus the script's one-second mtime pause, well short of the fake's 30 s sleep.
      expect(Date.now() - started).toBeLessThan(15_000);
    }, 30_000);

    it("doesn't resume without a session id", () => {
      const result = run([contract, "--worktree", worktree, "--write"], {
        ...capped,
        FAKE_MODE: "silent-hang",
        FAKE_HANDOFF: "written",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("result:    failure - timed out after 1s (no hand-off)");
      expect(existsSync(handoffArgs())).toBe(false);
    }, 30_000);
  });
});
