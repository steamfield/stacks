import type { TelemetryBatch } from "@steamfield/stacks-format";
import { expect, test } from "vitest";
import {
  normalizeFor,
  normalizeTelemetryBody,
  normalizeTerminal,
} from "../scripts/behavior-snapshot/normalize";

test("log snapshots keep error fields and messages when bundle frames move", () => {
  const normalize = normalizeFor({ scratch: "/tmp/snapshot", packageRoot: "/repo/packages/cli" });
  const record = {
    msg: "command",
    stack: "go-cli",
    cause: {
      name: "Usage",
      message: 'Invalid "command".',
      status: 2,
      stack: 'Usage: Invalid "command".\n    at one (/repo/packages/cli/dist/cli.mjs:1:2)',
    },
    defect: "TypeError\nat two (/repo/packages/cli/dist/cli.mjs:3:4)",
  };
  const expected = {
    ...record,
    cause: { ...record.cause, stack: 'Usage: Invalid "command".\n<FRAMES>' },
    defect: "TypeError\n<FRAMES>",
  };
  expect(normalize(JSON.stringify(record))).toBe(JSON.stringify(expected));
  expect(
    normalize(
      JSON.stringify(record).replace("at one", "at renamed").replace("cli.mjs:1:2", "cli.mjs:5:6"),
    ),
  ).toBe(JSON.stringify(expected));
});

test("scratch paths containing quotes or backslashes normalize in text and JSON", () => {
  const scratch = '/tmp/quoted"dir\\scratch';
  const packageRoot = '/repo/quoted"dir';
  const normalize = normalizeFor({ scratch, packageRoot });
  const paths = [`${scratch}/home`, `${packageRoot}/dist/stacks`];
  expect(normalize(paths.join("\n"))).toBe("<TMP>/home\n<CLI>/dist/stacks");
  expect(normalize(JSON.stringify(paths))).toBe('["<TMP>/home","<CLI>/dist/stacks"]');
});

test("a slow terminal redraw has the same snapshot as a fast step", () => {
  const clear = "\r\u001b[2K";
  const progress = "> test: true\r\n";
  const result = "\u001b[32mpassed\u001b[39m\r\n";
  const expected = (progress + result).replaceAll("\r\n", "\n");
  expect(normalizeTerminal(progress + clear + result)).toBe(expected);
  expect(
    normalizeTerminal(`^D\b\b${progress}${clear}/ test 0.1s${clear}- test 0.2s${clear}${result}`),
  ).toBe(expected);
});

test("only same-timestamp telemetry events lose the random UUID ordering", () => {
  const envelope = {
    schemaVersion: 3,
    installId: "00000000-0000-4000-8000-000000000001",
    cliVersion: "0.14.1",
    os: "darwin",
    nodeMajor: 24,
    agent: "none",
    sentAt: "2025-01-01T00:00:00.000Z",
  } as const;
  type Event = TelemetryBatch["events"][number];
  const shown: Event = {
    ...envelope,
    eventId: "00000000-0000-4000-8000-000000000002",
    type: "show",
    kind: "stack",
    id: "go-cli",
  };
  const failed: Event = {
    ...envelope,
    eventId: "00000000-0000-4000-8000-000000000003",
    type: "error",
    command: "new",
    code: "NotFound",
  };
  const normalize = (events: ReadonlyArray<Event>) =>
    normalizeTelemetryBody(JSON.stringify({ events }), (value) => value);
  const expected = JSON.stringify({ events: [failed, shown] });
  expect(normalize([shown, failed])).toBe(expected);
  expect(normalize([failed, shown])).toBe(expected);
  const later = { ...failed, sentAt: "2025-01-01T00:00:00.001Z" };
  expect(normalize([shown, later])).toBe(JSON.stringify({ events: [shown, later] }));
  expect(normalize([later, shown])).toBe(JSON.stringify({ events: [later, shown] }));
});
