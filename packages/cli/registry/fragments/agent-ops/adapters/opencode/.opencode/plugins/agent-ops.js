// https://opencode.ai/docs/plugins/ (OpenCode 1 local plugin callbacks).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AgentOps = async ({ $, directory }) => {
  const hooks = fileURLToPath(new URL("../../.claude/hooks/", import.meta.url));
  const sessions = new Map();

  async function run(script, payload) {
    const command =
      script === "check-patch.sh"
        ? fileURLToPath(new URL("../hooks/check-patch.sh", import.meta.url))
        : hooks + script;
    return await $`bash ${command} < ${Buffer.from(JSON.stringify(payload))}`
      .env({ ...process.env, CLAUDE_PROJECT_DIR: directory })
      .cwd(directory)
      .quiet()
      .nothrow();
  }

  function writeInput(args) {
    return {
      file_path: args.filePath,
      content: args.content,
      new_string: args.newString,
    };
  }

  async function guard(script, payload) {
    let denial;
    try {
      const result = await run(script, payload);
      const decision = result.stdout.toString().trim();
      const response = decision ? JSON.parse(decision) : undefined;
      if (response?.hookSpecificOutput?.permissionDecision === "deny") {
        denial = response.hookSpecificOutput.permissionDecisionReason;
      } else if (result.exitCode !== 0 || decision) {
        console.error(`agent-ops: ${script} failed; allowing call.`);
      } else if (result.stderr.toString().trim()) {
        console.error(result.stderr.toString().trim());
      }
    } catch {
      console.error(`agent-ops: ${script} unavailable or unreadable response; allowing call.`);
    }
    if (denial) throw new Error(denial);
  }

  function writtenFiles(input) {
    if (["write", "edit"].includes(input.tool)) return [input.args.filePath].filter(Boolean);
    if (input.tool !== "apply_patch") return [];
    return input.args.patchText
      .split("\n")
      .filter((line) => /^\*\*\* (Add File|Update File|Move to): /.test(line))
      .map((line) => line.slice(line.indexOf(": ") + 2));
  }

  async function lint(input, output, file) {
    const payload = {
      cwd: directory,
      session_id: input.sessionID,
      tool_input: { file_path: resolve(directory, file) },
    };
    sessions.set(input.sessionID, payload);
    const result = await run("lint-on-write.sh", payload);
    const response = result.stdout.toString().trim();
    if (response) {
      const context = JSON.parse(response).hookSpecificOutput.additionalContext;
      output.output += `\n${context}`;
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      const payload = { cwd: directory, tool_input: output.args };
      if (input.tool === "bash") await guard("block-destructive.sh", payload);
      if (input.tool === "apply_patch") {
        await guard("check-patch.sh", {
          ...payload,
          tool_input: { command: output.args.patchText },
        });
      }
      if (["write", "edit"].includes(input.tool)) {
        await guard("detect-secrets.sh", { ...payload, tool_input: writeInput(output.args) });
      }
    },
    "tool.execute.after": async (input, output) => {
      for (const file of new Set(writtenFiles(input))) await lint(input, output, file);
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      const id = event.properties.sessionID;
      const payload = sessions.get(id);
      if (!payload) return;
      sessions.delete(id);
      await run("format-changed.sh", payload);
    },
  };
};
