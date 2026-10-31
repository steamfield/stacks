// Telemetry is best effort: failures and defects are swallowed only at this boundary, because
// collection must never change a command's output or exit. Debug logs omit error messages.
import { type RunRecord, TelemetryEventV3 } from "@steamfield/stacks-format";
import { Cause, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../config";
import { Allowlist } from "../core/allowlist";
import { Registry } from "../core/registry/registry";
import { defectTrace } from "../logging";
import type { Consent, TelemetryFlush, TelemetryStatus } from "../schemas/telemetry";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { VERSION } from "../version";
import { deliver } from "./client";
import { completeAddFacts } from "./composition";
import { consent, standingOff } from "./consent";
import {
  type Envelope,
  type ErrorFacts,
  errorEvent,
  publicId,
  type ScaffoldFacts,
  type ShowFacts,
} from "./events";
import { settleNotice, showNotice } from "./notice";
import { markDepsSent, scaffold, verify } from "./projects";
import { enqueue } from "./spool";
import {
  DeferredScaffold,
  Install,
  installId,
  Notice,
  names,
  read,
  remove,
  type Storage,
  timestamp,
  uuid,
  write,
} from "./storage";

/** The privacy page is `/telemetry` on the host that receives the events. */
export const notice = (endpoint: string) =>
  `stacks collects anonymous usage and verify results, including allowlisted dependency names and major versions from project manifest and lock files after green verify runs. It never sends your code, paths or command output. Privacy and allowlist: ${new URL("/telemetry", endpoint).href}. Turn it off: stacks telemetry disable`;
export const dependencyNotice = (endpoint: string) =>
  `stacks now sends allowlisted dependency names and major versions from project manifest and lock files after green verify runs, normally no more than once every 7 days per project. Privacy and allowlist: ${new URL("/telemetry", endpoint).href}. Turn it off: stacks telemetry disable`;
const safe = <A, E, R>(effect: Effect.Effect<A, E, R>, fallback: A) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug("Telemetry unavailable").pipe(
        Effect.annotateLogs({ telemetry: true, defect: defectTrace(Cause.squash(cause)) }),
        Effect.as(fallback),
      ),
    ),
  );
const emitEvent = Effect.fn("telemetry.emitEvent")(function* (input: {
  store: Storage;
  output: Output["Service"] | undefined;
  debug: boolean;
  envelope: Effect.Effect<Envelope, unknown>;
  build: Effect.Effect<Omit<TelemetryEventV3, keyof Envelope>, unknown>;
  onQueued?: (event: TelemetryEventV3) => Effect.Effect<void, unknown>;
  eventId?: string;
}) {
  const event = yield* Schema.decodeUnknownEffect(TelemetryEventV3, {
    onExcessProperty: "error",
  })({
    ...(yield* input.envelope),
    ...(yield* input.build),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
  });
  if (input.debug) {
    if (input.output) yield* input.output.note(JSON.stringify(event));
    return;
  }
  yield* enqueue(input.store, event);
  if (input.onQueued) yield* input.onQueued(event);
});
export class Telemetry extends Context.Service<
  Telemetry,
  {
    consent: Effect.Effect<Consent>;
    notify: Effect.Effect<void>;
    markFlushAfterOutput: Effect.Effect<void>;
    flushAfterOutput: Effect.Effect<void>;
    status: Effect.Effect<TelemetryStatus>;
    recordScaffold: (input: ScaffoldFacts, registry: Registry["Service"]) => Effect.Effect<void>;
    recordShow: (input: ShowFacts) => Effect.Effect<void>;
    recordError: (input: ErrorFacts) => Effect.Effect<void>;
    recordVerify: (record: RunRecord) => Effect.Effect<void>;
    flush: Effect.Effect<void>;
    flushNow: Effect.Effect<TelemetryFlush>;
    clear: (reset: boolean) => Effect.Effect<boolean>;
  }
>()("stacks/Telemetry") {
  static layer = (options: { officialUrl?: string } = {}) =>
    Layer.effect(
      Telemetry,
      Effect.gen(function* () {
        const config = yield* AppConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const host = yield* Host;
        const client = yield* HttpClient.HttpClient;
        const allowlist = yield* Allowlist;
        const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
        const output = yield* Effect.serviceOption(Output);
        const store: Storage = {
          fs,
          path,
          root: path.join((yield* config.paths).state, "telemetry"),
        };
        const url = config.telemetry.url ?? options.officialUrl;
        let noticeRun = false;
        let ownsNotice: string | undefined;
        let previousNotice: typeof Notice.Type | undefined;
        let flushAfterOutput = false;
        let drainDeferred: Effect.Effect<void, unknown> = Effect.void;
        yield* Effect.addFinalizer(() =>
          safe(
            settleNotice(
              store,
              Option.isSome(output) ? output.value : undefined,
              ownsNotice,
              previousNotice,
            ),
            undefined,
          ),
        );
        const purge = Effect.gen(function* () {
          yield* remove(store, "spool");
          yield* remove(store, "claims");
          yield* remove(store, "deferred");
        });
        const check = consent({ config, store, url }).pipe(
          Effect.tap((reason) => (standingOff(reason) ? safe(purge, undefined) : Effect.void)),
        );
        const notify = safe(
          Effect.gen(function* () {
            if (noticeRun || url === undefined) return;
            const shown = yield* showNotice({
              store,
              output: Option.isSome(output) ? output.value : undefined,
              reason: yield* check,
              firstText: notice(url),
              secondText: dependencyNotice(url),
            });
            noticeRun = shown.shown;
            ownsNotice = shown.claimId;
            previousNotice = shown.previous;
            if (!noticeRun && !config.telemetry.debug && (yield* check) === "enabled")
              yield* drainDeferred;
          }),
          undefined,
        );
        const envelope = Effect.gen(function* (): Effect.fn.Return<Envelope, unknown> {
          return {
            schemaVersion: 3,
            eventId: yield* uuid,
            installId: yield* installId(store),
            cliVersion: VERSION,
            os: host.platform === "darwin" || host.platform === "linux" ? host.platform : "other",
            nodeMajor: host.nodeMajor,
            agent: yield* config.agent,
            sentAt: yield* timestamp,
          };
        });
        const onVerifyQueued = (event: TelemetryEventV3) =>
          event.type === "verify" && event.deps !== undefined
            ? markDepsSent(store, host.cwd, event.sentAt).pipe(Effect.provideContext(files))
            : Effect.void;
        const sendEvent = (
          build: Effect.Effect<Omit<TelemetryEventV3, keyof Envelope>, unknown>,
          verifyRun = false,
          eventId?: string,
        ) =>
          emitEvent({
            store,
            output: Option.isSome(output) ? output.value : undefined,
            debug: config.telemetry.debug,
            envelope,
            build,
            ...(verifyRun ? { onQueued: onVerifyQueued } : {}),
            ...(eventId === undefined ? {} : { eventId }),
          });
        drainDeferred = Effect.gen(function* () {
          for (const name of (yield* names(store, "deferred"))
            .filter((name) => name.endsWith(".json"))
            .sort()) {
            const file = store.path.join("deferred", name);
            const saved = yield* Effect.result(read(store, file, DeferredScaffold));
            if (saved._tag === "Failure") {
              yield* remove(store, file);
              continue;
            }
            const { eventId, ...event } = saved.success;
            yield* sendEvent(Effect.succeed(event), false, eventId);
            yield* remove(store, file);
          }
        });
        const queue = (
          build: Effect.Effect<Omit<TelemetryEventV3, keyof Envelope>, unknown>,
          verifyRun = false,
        ) =>
          safe(
            notify.pipe(
              Effect.andThen(check),
              Effect.flatMap((reason) => {
                if (noticeRun || reason !== "enabled") return Effect.void;
                return sendEvent(build, verifyRun);
              }),
            ),
            undefined,
          );
        const recordScaffold = (input: ScaffoldFacts, registry: Registry["Service"]) => {
          const facts: Effect.Effect<ScaffoldFacts, unknown> =
            input.type === "new"
              ? Effect.succeed(input)
              : completeAddFacts(input).pipe(
                  Effect.provideService(Registry, registry),
                  Effect.provideContext(files),
                );
          return safe(
            notify.pipe(
              Effect.andThen(check),
              Effect.flatMap((reason) => {
                if (reason !== "enabled" && !(noticeRun && reason === "not_notified"))
                  return Effect.void;
                return facts.pipe(
                  Effect.flatMap((value) =>
                    noticeRun ? deferScaffold(value) : sendEvent(scaffold(store, value)),
                  ),
                );
              }),
            ),
            undefined,
          );
        };
        // The notice run queues nothing, but links the project now so its first verify counts.
        const deferScaffold = (value: ScaffoldFacts) =>
          Effect.gen(function* () {
            const event = yield* scaffold(store, value);
            const file = store.path.join("deferred", `${value.manifest.projectId}.json`);
            yield* write(store, file, { ...event, eventId: yield* uuid });
          });
        const recordVerify = (record: RunRecord) =>
          queue(
            verify({
              store,
              cwd: host.cwd,
              record,
              cachedAllowlist: allowlist.cached,
            }).pipe(Effect.provideContext(files)),
            true,
          );
        const flush = (deadline: number) =>
          safe(
            Effect.gen(function* (): Effect.fn.Return<TelemetryFlush, unknown> {
              const reason = yield* check;
              if (standingOff(reason)) yield* purge;
              if (reason !== "enabled" || noticeRun || config.telemetry.debug || !url)
                return {
                  sent: 0,
                  kept: (yield* names(store, "spool")).length,
                  rejected: 0,
                  reason,
                };
              return yield* deliver({ store, client, url, deadline });
            }),
            { sent: 0, kept: 0, rejected: 0, reason: "home_not_writable" } satisfies TelemetryFlush,
          );
        const status = safe(
          Effect.gen(function* (): Effect.fn.Return<TelemetryStatus, unknown> {
            const reason = yield* check;
            const install = yield* read(store, "install.json", Install).pipe(Effect.option);
            const notice = yield* read(store, "notice.json", Notice).pipe(Effect.option);
            return {
              reason,
              ...(Option.isSome(install) ? install.value : {}),
              ...(Option.isSome(notice) && !notice.value.pending
                ? { noticeShownAt: notice.value.noticeShownAt }
                : {}),
              spooled: (yield* names(store, "spool")).length,
            };
          }),
          { reason: "home_not_writable", spooled: 0 } satisfies TelemetryStatus,
        );
        return {
          consent: safe(
            check.pipe(
              Effect.map(
                (reason): Consent => (noticeRun && reason === "not_notified" ? "enabled" : reason),
              ),
            ),
            "home_not_writable",
          ),
          notify,
          markFlushAfterOutput: Effect.sync(() => {
            flushAfterOutput = true;
          }),
          flushAfterOutput: Effect.suspend(() =>
            flushAfterOutput ? flush(800).pipe(Effect.asVoid) : Effect.void,
          ),
          status,
          recordScaffold,
          recordVerify,
          recordShow: (entry: ShowFacts) =>
            queue(
              Effect.sync(() => ({ type: "show" as const, kind: entry.kind, id: publicId(entry) })),
            ),
          recordError: (input: ErrorFacts) => queue(Effect.sync(() => errorEvent(input))),
          flush: flush(800).pipe(Effect.asVoid),
          flushNow: flush(5000),
          clear: (reset: boolean) =>
            safe(
              Effect.gen(function* () {
                yield* purge;
                for (const name of ["projects", "install.json", "flush.json"])
                  yield* remove(store, name);
                if (reset) yield* installId(store);
                return true;
              }),
              false,
            ),
        };
      }),
    );
}
