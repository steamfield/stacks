import { Clock, Effect, Option } from "effect";
import type { Consent } from "../schemas/telemetry";
import type { Output } from "../services/output";
import { directory, Notice, read, remove, type Storage, timestamp, uuid, write } from "./storage";

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
      JSON.stringify({ noticeShownAt: yield* timestamp, noticeVersion: 2, pending: true, claimId }),
      { flag: "wx", mode: 0o600 },
    ),
  );
  if (created._tag === "Failure") return undefined;
  yield* output.notice(text);
  if (yield* output.noticeDelivered) {
    yield* write(store, "notice.json", { noticeShownAt: yield* timestamp, noticeVersion: 2 });
    return undefined;
  }
  return claimId;
});

const notifySecond = Effect.fn("telemetry.notifySecond")(function* (
  store: Storage,
  output: Output["Service"],
  text: string,
) {
  const shown = yield* read(store, "notice.json", Notice).pipe(Effect.option);
  if (Option.isNone(shown) || (shown.value.noticeVersion ?? 1) >= 2)
    return { shown: false, claimId: undefined, previous: undefined };
  const claimId = `second:${yield* uuid}`;
  const claimed = yield* Effect.result(
    write(store, "notice.json", { ...shown.value, noticeVersion: 2, pending: true, claimId }),
  );
  if (claimed._tag === "Failure") return { shown: true, claimId: undefined, previous: undefined };
  yield* output.notice(text);
  if (yield* output.noticeDelivered) {
    yield* write(store, "notice.json", {
      noticeShownAt: shown.value.noticeShownAt,
      noticeVersion: 2,
    });
    return { shown: true, claimId: undefined, previous: undefined };
  }
  return {
    shown: true,
    claimId,
    previous: shown.value,
  };
});

export const showNotice = Effect.fn("telemetry.showNotice")(function* (input: {
  store: Storage;
  output: Output["Service"] | undefined;
  reason: Consent;
  firstText: string;
  secondText: string;
}) {
  const { store, output, reason } = input;
  if (reason === "enabled") {
    if (output === undefined) {
      const previous = yield* read(store, "notice.json", Notice).pipe(Effect.option);
      return {
        shown: Option.isSome(previous) && (previous.value.noticeVersion ?? 1) < 2,
        claimId: undefined,
        previous: undefined,
      };
    }
    return yield* notifySecond(store, output, input.secondText);
  }
  if (reason !== "not_notified") return { shown: false, claimId: undefined, previous: undefined };
  if (output === undefined) return { shown: true, claimId: undefined, previous: undefined };
  return {
    shown: true,
    claimId: yield* claimNotice(store, output, input.firstText),
    previous: undefined,
  };
});

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
    yield* write(store, "notice.json", {
      noticeShownAt: previous?.noticeShownAt ?? (yield* timestamp),
      noticeVersion: 2,
    });
  } else if (previous) yield* write(store, "notice.json", previous);
  else yield* remove(store, "notice.json");
});

/** Recover an abandoned exclusive claim; never discard a newer claimant's marker. */
const recoverNotice = Effect.fn("telemetry.recoverNotice")(function* (store: Storage) {
  const target = store.path.join(store.root, "notice.json");
  const stat = yield* store.fs.stat(target).pipe(Effect.option);
  if (Option.isNone(stat)) return;
  const now = yield* Clock.currentTimeMillis;
  const modified = Option.getOrElse(stat.value.mtime, () => new Date(now)).getTime();
  if (now - modified <= 600_000) return;
  const observed = yield* read(store, "notice.json", Notice).pipe(Effect.option);
  if (Option.isSome(observed) && !observed.value.pending) return;
  const retired = `.notice-${yield* uuid}`;
  const moved = yield* store.fs
    .rename(target, store.path.join(store.root, retired))
    .pipe(Effect.result);
  if (moved._tag === "Failure") return;
  const claimed = yield* read(store, retired, Notice).pipe(Effect.option);
  const same =
    Option.isSome(observed) &&
    Option.isSome(claimed) &&
    observed.value.claimId === claimed.value.claimId &&
    observed.value.noticeShownAt === claimed.value.noticeShownAt;
  if (Option.isSome(claimed) && (!same || !claimed.value.pending)) {
    // link is exclusive: a marker created since the rename wins, and is left untouched.
    yield* store.fs.link(store.path.join(store.root, retired), target).pipe(Effect.ignore);
  }
  yield* remove(store, retired);
});
