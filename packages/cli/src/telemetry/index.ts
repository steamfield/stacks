/**
 * Owns telemetry recording and delivery for an invocation. `safe` keeps telemetry best effort.
 */
import { type RunRecord, TelemetryEventV3 } from "@steamfield/stacks-format";
import { Cause, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpClient } from "effect/http";
import { AppConfig } from "../config";
import { TELEMETRY_FLUSH_AFTER_COMMAND_MS, TELEMETRY_FLUSH_NOW_MS } from "../constants";
import { Allowlist } from "../core/allowlist";
import { defined } from "../core/object";
import { Registry } from "../core/registry/registry";
import { defectTrace } from "../logging";
import type { Consent, TelemetryFlush, TelemetryStatus } from "../schemas/telemetry";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { VERSION } from "../version";
import { completeAddFacts } from "./composition";
import { consent, standingOff } from "./consent";
import { deliver } from "./deliver";
import {
  type Envelope,
  type ErrorFacts,
  errorEvent,
  publicId,
  type ScaffoldFacts,
  type ShowFacts,
} from "./events";
import { linkScaffold, locateProject, markDepsSpooled, verifyEventFor } from "./links";
import { NO_NOTICE, type NoticeOutcome, settleNotice, showNotice } from "./notice";
import * as spoolFiles from "./spool";
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

/** An event body: everything but the envelope fields. */
type EventBody = Omit<TelemetryEventV3, keyof Envelope>;

/** The privacy page is `/telemetry` on the host that receives the events. */
const notice = (endpoint: string) =>
  `stacks collects anonymous usage and verify results, including allowlisted dependency names and major versions from project manifest and lock files after green verify runs. It never sends your code, paths or command output. Privacy and allowlist: ${new URL("/telemetry", endpoint).href}. Turn it off: stacks telemetry disable`;
const dependencyNotice = (endpoint: string) =>
  `stacks now sends allowlisted dependency names and major versions from project manifest and lock files after green verify runs, normally no more than once every 7 days per project. Privacy and allowlist: ${new URL("/telemetry", endpoint).href}. Turn it off: stacks telemetry disable`;

/**
 * Runs a telemetry effect so that nothing it does can escape: any failure, defect or interruption
 * becomes `fallback`, logged at debug level with the defect's class and frames and never its
 * message.
 */
const safe = <A, E, R>(effect: Effect.Effect<A, E, R>, fallback: A) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug("Telemetry unavailable").pipe(
        Effect.annotateLogs({ telemetry: true, defect: defectTrace(Cause.squash(cause)) }),
        Effect.as(fallback),
      ),
    ),
  );

/** The envelope for a new event; creates the install id the first time it is needed. */
const makeEnvelope = (input: {
  store: Storage;
  host: Host["Service"];
  config: AppConfig["Service"];
}) =>
  Effect.gen(function* (): Effect.fn.Return<Envelope, unknown> {
    const { store, host, config } = input;
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

/**
 * Whether a scaffold is recorded at all: when telemetry is enabled, and on the notice run, where
 * consent still reads `not_notified` but the scaffold is saved for later.
 */
const recordsScaffold = (reason: Consent, noticeRun: boolean) =>
  reason === "enabled" || (noticeRun && reason === "not_notified");

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
  static layer = () =>
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
        const output = Option.getOrUndefined(yield* Effect.serviceOption(Output));
        const store: Storage = {
          fs,
          path,
          root: (yield* config.paths).telemetry,
        };
        const url = config.telemetryUrl;
        // This invocation's state: the notice outcome and whether main should flush after output.
        let noticeOutcome: NoticeOutcome = NO_NOTICE;
        let flushAfterOutput = false;
        yield* Effect.addFinalizer(() =>
          safe(
            settleNotice(store, output, noticeOutcome.claimId, noticeOutcome.previous),
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
        const envelope = makeEnvelope({ store, host, config });
        /**
         * A deferred scaffold keeps its saved event id. Debug output leaves both the spool and
         * the link's dependency interval untouched.
         */
        const spool = Effect.fn("telemetry.spool")(function* (
          build: Effect.Effect<EventBody, unknown>,
          eventId?: string,
        ) {
          const event = yield* Schema.decodeUnknownEffect(TelemetryEventV3, {
            onExcessProperty: "error",
          })({
            ...(yield* envelope),
            ...(yield* build),
            ...defined({ eventId }),
          });
          if (config.telemetry.debug) {
            if (output) yield* output.note(JSON.stringify(event));
            return;
          }
          yield* spoolFiles.write(store, event);
          return event;
        });

        /** Spools deferred scaffolds in file name order. */
        const drainDeferred = Effect.gen(function* () {
          const saved = (yield* names(store, "deferred")).filter((name) => name.endsWith(".json"));
          for (const name of saved.sort()) {
            const file = store.path.join("deferred", name);
            const deferred = yield* Effect.result(read(store, file, DeferredScaffold));
            if (deferred._tag === "Success") {
              const { eventId, ...event } = deferred.success;
              yield* spool(Effect.succeed(event), eventId);
            }
            yield* remove(store, file);
          }
        });

        /**
         * An enabled run outside debug mode writes deferred scaffolds to the spool before
         * recording its own events.
         */
        const notify = safe(
          Effect.gen(function* () {
            if (noticeOutcome.isNoticeRun || url === undefined) return;
            noticeOutcome = yield* showNotice({
              store,
              output,
              reason: yield* check,
              firstText: notice(url),
              secondText: dependencyNotice(url),
            });
            if (
              !noticeOutcome.isNoticeRun &&
              !config.telemetry.debug &&
              (yield* check) === "enabled"
            )
              yield* drainDeferred;
          }),
          undefined,
        );

        /** Records an event when telemetry is enabled and this isn't the notice run. */
        const record = (event: Effect.Effect<unknown, unknown>) =>
          safe(
            notify.pipe(
              Effect.andThen(check),
              Effect.flatMap((reason) => {
                if (noticeOutcome.isNoticeRun || reason !== "enabled") return Effect.void;
                return event;
              }),
              Effect.asVoid,
            ),
            undefined,
          );

        // The notice run queues nothing, but links the project now so its first verify counts.
        const deferScaffold = (value: ScaffoldFacts) =>
          Effect.gen(function* () {
            const event = yield* linkScaffold(store, value);
            const file = store.path.join("deferred", `${value.manifest.projectId}.json`);
            yield* write(store, file, { ...event, eventId: yield* uuid });
          });

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
                if (!recordsScaffold(reason, noticeOutcome.isNoticeRun)) return Effect.void;
                return facts.pipe(
                  Effect.flatMap((value) =>
                    noticeOutcome.isNoticeRun
                      ? deferScaffold(value)
                      : spool(linkScaffold(store, value)).pipe(Effect.asVoid),
                  ),
                );
              }),
            ),
            undefined,
          );
        };

        const recordVerify = Effect.fn("telemetry.recordVerify")(function* (run: RunRecord) {
          const location = yield* Effect.cached(
            locateProject(host.cwd).pipe(Effect.provideContext(files)),
          );
          const event = yield* spool(
            verifyEventFor({
              store,
              location,
              record: run,
              cachedAllowlist: allowlist.cached,
            }).pipe(Effect.provideContext(files)),
          );
          if (event?.type === "verify" && event.deps !== undefined)
            yield* markDepsSpooled(
              store,
              { cwd: host.cwd, location: yield* location },
              event.sentAt,
            ).pipe(Effect.provideContext(files));
        }, record);

        /** Sends queued events within `deadline` ms; otherwise reports why nothing was sent. */
        const flush = (deadline: number) =>
          safe(
            Effect.gen(function* (): Effect.fn.Return<TelemetryFlush, unknown> {
              const reason = yield* check;
              if (standingOff(reason)) yield* purge;
              if (
                reason !== "enabled" ||
                noticeOutcome.isNoticeRun ||
                config.telemetry.debug ||
                !url
              )
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
            const shown = yield* read(store, "notice.json", Notice).pipe(Effect.option);
            return {
              reason,
              ...(Option.isSome(install) ? install.value : {}),
              ...(Option.isSome(shown) && !shown.value.pending
                ? { noticeShownAt: shown.value.noticeShownAt }
                : {}),
              spooled: (yield* names(store, "spool")).length,
            };
          }),
          { reason: "home_not_writable", spooled: 0 } satisfies TelemetryStatus,
        );

        return {
          // The notice run reads as enabled, so `new` goes on to record (and defer) its scaffold.
          consent: safe(
            check.pipe(
              Effect.map(
                (reason): Consent =>
                  noticeOutcome.isNoticeRun && reason === "not_notified" ? "enabled" : reason,
              ),
            ),
            "home_not_writable",
          ),
          notify,
          markFlushAfterOutput: Effect.sync(() => {
            flushAfterOutput = true;
          }),
          flushAfterOutput: Effect.suspend(() =>
            flushAfterOutput
              ? flush(TELEMETRY_FLUSH_AFTER_COMMAND_MS).pipe(Effect.asVoid)
              : Effect.void,
          ),
          status,
          recordScaffold,
          recordVerify,
          recordShow: (entry: ShowFacts) =>
            record(
              spool(
                Effect.sync(() => ({
                  type: "show" as const,
                  kind: entry.kind,
                  id: publicId(entry),
                })),
              ),
            ),
          recordError: (input: ErrorFacts) => record(spool(Effect.sync(() => errorEvent(input)))),
          flush: flush(TELEMETRY_FLUSH_AFTER_COMMAND_MS).pipe(Effect.asVoid),
          flushNow: flush(TELEMETRY_FLUSH_NOW_MS),
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
