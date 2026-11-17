import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Manifest, TelemetryEventV3 } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { ShowReport } from "../src/schemas/show";
import { fakeAgent } from "./helpers/agents";
import { scriptedTerminal } from "./helpers/cli";
import {
  type PickerWorkspace,
  pickerCli,
  pickerManifest,
  pickerNew,
  pickerWorkspace,
} from "./helpers/picker";
import { ok, spooled, telemetryRoot, telemetryServer } from "./helpers/telemetry";

const launchSnapshot = Schema.fromJsonString(
  Schema.Struct({
    handoff: Manifest.fields.handoff.schema,
    events: Schema.Array(TelemetryEventV3),
  }),
);

/** The chosen agent records exactly what is visible when it first takes over. */
function recordAtLaunch(workspace: PickerWorkspace) {
  const snapshot = join(workspace.home, "at-launch.json");
  const spool = join(telemetryRoot(workspace.home), "spool");
  writeFileSync(
    join(workspace.bin, "codex"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const spool = ${JSON.stringify(spool)};
const files = fs.existsSync(spool) ? fs.readdirSync(spool) : [];
const events = files.map(name => JSON.parse(fs.readFileSync(path.join(spool, name), "utf8")));
const { handoff } = JSON.parse(fs.readFileSync(".stacks/manifest.json", "utf8"));
fs.writeFileSync(${JSON.stringify(snapshot)}, JSON.stringify({ handoff, events }));
`,
    { mode: 0o755 },
  );
  return () =>
    Schema.decodeUnknownSync(launchSnapshot, { onExcessProperty: "error" })(
      readFileSync(snapshot, "utf8"),
    );
}

test.each(["new", "add"])(
  "%s spools the settled handoff before starting the chosen agent",
  async (command) => {
    const workspace = pickerWorkspace();
    const server = await telemetryServer();
    try {
      if (command === "add") ok(await pickerNew(workspace, ["--json"]));
      server.mode("fail");
      const options = { releaseBuild: true, env: { STACKS_TELEMETRY_URL: server.url } };
      const notice = await pickerCli(workspace, ["show", "picker-stack", "--json"], options);
      ok(notice);
      const report = Schema.decodeUnknownSync(Schema.fromJsonString(ShowReport), {
        onExcessProperty: "error",
      })(notice.stdout);
      expect(report.notice).toBeDefined();
      expect(spooled(workspace.home)).toEqual([]);

      const claude = fakeAgent(workspace.bin, "claude");
      const atLaunch = recordAtLaunch(workspace);
      const observeLaunchLine = () => ({
        handoff: pickerManifest(workspace.project).handoff,
        events: spooled(workspace.home),
      });
      let atLaunchLine: ReturnType<typeof observeLaunchLine> | undefined;
      const handoffOptions = {
        ...options,
        terminal: scriptedTerminal(["2"]),
        stdout: async (text: string) => {
          if (text.startsWith("Launching ")) atLaunchLine = observeLaunchLine();
        },
      };
      const run =
        command === "new"
          ? await pickerNew(workspace, [], handoffOptions)
          : await pickerCli(
              workspace,
              ["add", "picker-extra", "--dir", workspace.project],
              handoffOptions,
            );

      ok(run);
      expect(run.stdout).toContain("Launching");
      expect(claude.ran()).toBe(false);
      const { handoff, events } = atLaunch();
      expect(handoff).toEqual({ kind: "launch", agent: "codex", at: expect.any(String) });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: command, handoff: "launch" });
      expect(atLaunchLine, "the launch line must follow the manifest and spool writes").toEqual({
        handoff,
        events,
      });
    } finally {
      try {
        await server.close();
      } finally {
        workspace.cleanup();
      }
    }
  },
);
