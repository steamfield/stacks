/**
 * Owns delivery of the telemetry privacy notices. A claim keeps concurrent invocations from
 * displaying the same notice.
 */
import { Clock, Effect, Option } from "effect";
import type { Consent } from "../schemas/telemetry";
import type { Output } from "../services/output";
import { directory, Notice, read, remove, type Storage, timestamp, uuid, write } from "./storage";

/** The notice version this CLI shows; an older recorded version owes the second notice. */
const NOTICE_VERSION = 2;
/** A pending claim untouched this long belongs to a run that never settled it. */
const STALE_CLAIM_MS = 600_000;

/**
 * `isNoticeRun` covers a due notice even without an `Output`. `claimId` is set when
 * this run holds a pending claim it must settle, with `previous` the record the claim replaced.
 */
export type NoticeOutcome = {
  isNoticeRun: boolean;
  claimId: string | undefined;
  previous: typeof Notice.Type | undefined;
};

/** No notice is due on this run. */
export const NO_NOTICE: NoticeOutcome = {
  isNoticeRun: false,
  claimId: undefined,
  previous: undefined,
};
const NOTICE_WITHOUT_CLAIM: NoticeOutcome = {
  isNoticeRun: true,
  claimId: undefined,
  previous: undefined,
};

const settledRecord = (noticeShownAt: string) => ({ noticeShownAt, noticeVersion: NOTICE_VERSION });

/**
 * Prints the first notice if this run wins the exclusive create of `notice.json`, and returns the
 * claim id when its delivery is still to be confirmed. A run that loses the race prints nothing.
 */
const claimNotice = Effect.fn("telemetry.claimNotice")(function* (
  store: Storage,
  output: Output["Service"],
  text: string,
) {
  yield* directory(store, store.root);
  yield* recoverNotice(store);
  const claimId = yield* uuid;
  const created = yield* Effect.result(
    store.fs.writeFileString(
      store.path.join(store.root, "notice.json"),
      JSON.stringify({
        noticeShownAt: yield* timestamp,
        noticeVersion: NOTICE_VERSION,
        pending: true,
        claimId,
      }),
      { flag: "wx", mode: 0o600 },
    ),
  );
  if (created._tag === "Failure") return undefined;
  yield* output.notice(text);
  if (yield* output.noticeDelivered) {
    yield* write(store, "notice.json", settledRecord(yield* timestamp));
    return undefined;
  }
  return claimId;
});

/** Whether a recorded notice is older than the current version, so the second notice is due. */
const owesSecondNotice = (notice: typeof Notice.Type) =>
  (notice.noticeVersion ?? 1) < NOTICE_VERSION;

/**
 * Prints the second notice when the recorded notice is an older version. The claim id carries a
 * `second:` prefix tells `noticeAcknowledged` the first notice already counts while the update
 * is pending.
 */
const notifySecond = Effect.fn("telemetry.notifySecond")(function* (
  store: Storage,
  output: Output["Service"],
  text: string,
) {
  const shown = yield* read(store, "notice.json", Notice).pipe(Effect.option);
  if (Option.isNone(shown) || !owesSecondNotice(shown.value)) return NO_NOTICE;
  const claimId = `second:${yield* uuid}`;
  const claimed = yield* Effect.result(
    write(store, "notice.json", {
      ...shown.value,
      noticeVersion: NOTICE_VERSION,
      pending: true,
      claimId,
    }),
  );
  if (claimed._tag === "Failure") return NOTICE_WITHOUT_CLAIM;
  yield* output.notice(text);
  if (yield* output.noticeDelivered) {
    yield* write(store, "notice.json", settledRecord(shown.value.noticeShownAt));
    return NOTICE_WITHOUT_CLAIM;
  }
  return { isNoticeRun: true, claimId, previous: shown.value };
});

/**
 * Decides whether this run is a notice run and, when an `Output` is available, prints the notice
 * that is due. Without an `Output` nothing is printed or claimed; the outcome only says whether a
 * notice is owed.
 */
export const showNotice = Effect.fn("telemetry.showNotice")(function* (input: {
  store: Storage;
  output: Output["Service"] | undefined;
  reason: Consent;
  firstText: string;
  secondText: string;
}) {
  const { store, output, reason } = input;
  if (reason === "enabled") {
    if (output !== undefined) return yield* notifySecond(store, output, input.secondText);
    const previous = yield* read(store, "notice.json", Notice).pipe(Effect.option);
    return Option.isSome(previous) && owesSecondNotice(previous.value)
      ? NOTICE_WITHOUT_CLAIM
      : NO_NOTICE;
  }
  if (reason !== "not_notified") return NO_NOTICE;
  if (output === undefined) return NOTICE_WITHOUT_CLAIM;
  return {
    isNoticeRun: true,
    claimId: yield* claimNotice(store, output, input.firstText),
    previous: undefined,
  };
});

/**
 * Settles this run's pending claim: a delivered notice becomes a plain record, an undelivered one
 * puts back the record the claim replaced (or removes the file for a first notice). A claim some
 * other run has replaced since is left alone.
 */
export const settleNotice = Effect.fn("telemetry.settleNotice")(function* (
  store: Storage,
  output: Output["Service"] | undefined,
  claimId: string | undefined,
  previous: typeof Notice.Type | undefined,
) {
  if (!claimId || output === undefined) return;
  const current = yield* read(store, "notice.json", Notice).pipe(Effect.option);
  if (Option.isNone(current) || current.value.claimId !== claimId) return;
  if (yield* output.noticeDelivered) {
    yield* write(
      store,
      "notice.json",
      settledRecord(previous?.noticeShownAt ?? (yield* timestamp)),
    );
  } else if (previous) yield* write(store, "notice.json", previous);
  else yield* remove(store, "notice.json");
});

/**
 * Whether a marker moved aside by `recoverNotice` has to go back: it changed between the read and
 * the move (another run wrote it), or it was never a pending claim.
 */
const keepRetired = (
  observed: Option.Option<typeof Notice.Type>,
  retired: Option.Option<typeof Notice.Type>,
) => {
  if (Option.isNone(retired)) return false;
  const unchanged =
    Option.isSome(observed) &&
    observed.value.claimId === retired.value.claimId &&
    observed.value.noticeShownAt === retired.value.noticeShownAt;
  return !unchanged || !retired.value.pending;
};

/** Recover an abandoned exclusive claim; never discard a newer claimant's marker. */
const recoverNotice = Effect.fn("telemetry.recoverNotice")(function* (store: Storage) {
  const target = store.path.join(store.root, "notice.json");
  const stat = yield* store.fs.stat(target).pipe(Effect.option);
  if (Option.isNone(stat)) return;
  const now = yield* Clock.currentTimeMillis;
  const modified = Option.getOrElse(stat.value.mtime, () => new Date(now)).getTime();
  if (now - modified <= STALE_CLAIM_MS) return;
  const observed = yield* read(store, "notice.json", Notice).pipe(Effect.option);
  if (Option.isSome(observed) && !observed.value.pending) return;
  // Move the marker aside atomically, then check that what moved is the marker that was read.
  const retired = `.notice-${yield* uuid}`;
  const moved = yield* store.fs
    .rename(target, store.path.join(store.root, retired))
    .pipe(Effect.result);
  if (moved._tag === "Failure") return;
  const claimed = yield* read(store, retired, Notice).pipe(Effect.option);
  if (keepRetired(observed, claimed)) {
    // link is exclusive: a marker created since the rename wins, and is left untouched.
    yield* store.fs.link(store.path.join(store.root, retired), target).pipe(Effect.ignore);
  }
  yield* remove(store, retired);
});
