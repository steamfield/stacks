import { TelemetryBatch } from "@steamfield/stacks-format";
import { Schema } from "effect";

export type Normalize = (text: string) => string;

const ERASE = "\r\u001b[2K";
const TRAILING_TERMINAL_CR = /\r+(?=\n|$)/g;

export function normalizeTerminal(text: string) {
  // script(1) can echo its injected EOF. Spinner redraws depend on when a step is scheduled.
  return text
    .replaceAll("^D\b\b", "")
    .split(ERASE)
    .filter((part, index) => index === 0 || !/^[|/\\-] [^\r\n]*$/.test(part))
    .join("")
    .replace(TRAILING_TERMINAL_CR, "");
}

type Event = TelemetryBatch["events"][number];
const isBatch = Schema.is(TelemetryBatch);

function orderTiedEvents(events: ReadonlyArray<Event>) {
  const ordered: Event[] = [];
  let tied: Event[] = [];
  const byType = (a: Event, b: Event) => a.type.localeCompare(b.type, "en");
  for (const event of events) {
    if (tied.length > 0 && tied[0]?.sentAt !== event.sentAt) {
      ordered.push(...tied.sort(byType));
      tied = [];
    }
    tied.push(event);
  }
  return [...ordered, ...tied.sort(byType)];
}

export function normalizeTelemetryBody(body: string, normalize: Normalize) {
  let batch: unknown;
  try {
    batch = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) return normalize(body);
    throw error;
  }
  if (!isBatch(batch)) return normalize(body);
  // The spool breaks same-millisecond ties by random event ID. Keep other events in wire order.
  const events = orderTiedEvents(batch.events);
  const reordered = events.some((event, index) => event !== batch.events[index]);
  return normalize(reordered ? JSON.stringify({ ...batch, events }) : body);
}

const ISO_TIME = /\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\b/g;
const RANDOM_ID = /\b[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\b/gi;
const JSON_TIMING =
  /("(?:duration|durationMs|secondsSinceCreated|secondsSinceScaffold|secondsToFirstTestPass|minutesToGreen|minutesToLastGreen|minutesToFirstTest)"\s*:\s*)-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;

export function normalizeFor({
  scratch,
  packageRoot,
  telemetryUrl,
}: {
  scratch: string;
  packageRoot: string;
  telemetryUrl?: string;
}): Normalize {
  const started = Date.now();
  const ids = new Map<string, string>();

  // The scratch path includes every isolated HOME, XDG directory and project. The sink port is ephemeral.
  const paths = (text: string) => {
    const replacePath = (input: string, path: string, alias: string) =>
      input.replaceAll(JSON.stringify(path).slice(1, -1), alias).replaceAll(path, alias);
    let result = replacePath(text, scratch, "<TMP>");
    result = replacePath(result, packageRoot, "<CLI>");
    if (telemetryUrl !== undefined) result = result.replaceAll(telemetryUrl, "<TELEMETRY_URL>");
    return result;
  };

  // Alias random IDs in encounter order, keeping references and the second-notice prefix intact.
  const randomIds = (text: string) =>
    text
      .replace(/("invocationId"\s*:\s*")\d+-[a-z0-9]+(")/g, "$1<INVOCATION>$2")
      .replace(RANDOM_ID, (id) => {
        const alias = ids.get(id) ?? `<UUID_${ids.size + 1}>`;
        ids.set(id, alias);
        return alias;
      });

  // Wall-clock values vary. Retain old ledger and fixture dates, numeric types and stable buckets.
  const timings = (text: string) =>
    text
      .replace(ISO_TIME, (time) => (Date.parse(time) >= started ? "<TIME>" : time))
      .replace(JSON_TIMING, (_match, field: string) => `${field}0`)
      .replace(/(\(exit \d+, |\(| skipped; )\d+\.\d+s(?=\))/g, "$1<TIME>s")
      .replace(
        /^(Minutes to (?:green|last green|first successful test command \(run completion\)): )\d+(?:\.\d+)?$/gm,
        "$1<TIME>",
      );

  // Minified names and locations move on rebuild. Keep the defect class and each error's message.
  const stackFrames = (text: string) =>
    text.replace(
      /("(?:defect|stack)"\s*:\s*")((?:[^"\\]|\\.)*)(")/g,
      (_match, field: string, value: string, quote: string) =>
        field + value.replace(/\\n[ \t]*at .*$/, "\\n<FRAMES>") + quote,
    );

  return (text) => stackFrames(timings(randomIds(paths(text))));
}
