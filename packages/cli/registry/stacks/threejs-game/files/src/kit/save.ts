/**
 * Versioned save storage on IndexedDB, one database per game.
 *
 * Written on the assumption that migrations and schemas will sometimes be wrong. A save that can't
 * be read, or that came from newer code (after a rollback), is never overwritten: load() reports
 * why, save() refuses for that slot, and exportJson() still hands the player their raw data.
 */
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import { createLogger, type Migrations, type SaveSchema } from "./core/index.ts";

export interface SaveStoreOptions<T> {
  /** The game's id (src/game.ts). Each game gets its own database: <gameId>-saves. */
  gameId: string;
  /** Current save format version. Bump it and add a migration whenever the shape changes. */
  version: number;
  /** Validates the current version's shape (a Zod schema works). */
  schema: SaveSchema<T>;
  /** migrate[n] upgrades version n to n+1. */
  migrate?: Migrations;
}

export type LoadResult<T> =
  | { kind: "ok"; data: T; migratedFrom?: number }
  | { kind: "empty" }
  | { kind: "unreadable"; error: string }
  | { kind: "newer-than-code"; version: number };

export type SaveResult = { ok: true } | { ok: false; reason: string };

/**
 * persistent: browser agreed not to evict. best-effort: IndexedDB works but may be evicted.
 * memory-only: no IndexedDB (private mode); progress is lost on reload.
 * read-only: the game is open in another tab, which owns writes.
 */
export type SaveStatus = "persistent" | "best-effort" | "memory-only" | "read-only";

interface Envelope {
  version: number;
  savedAt: string;
  data: unknown;
}

interface Backend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const log = createLogger("kit:save");

export interface SaveStore<T> {
  readonly status: SaveStatus;
  load(slot: string): Promise<LoadResult<T>>;
  save(slot: string, data: T): Promise<SaveResult>;
  remove(slot: string): Promise<void>;
  slots(): Promise<string[]>;
  /** Raw stored JSON for a slot, including unreadable or newer-than-code saves. */
  exportJson(slot: string): Promise<string | null>;
  /** Validates and migrates an exported file, then writes it to `slot`. */
  importJson(slot: string, json: string): Promise<LoadResult<T>>;
  /** Ask the browser not to evict saves. Call from a user gesture: Firefox shows a prompt. */
  requestPersistence(): Promise<SaveStatus>;
}

type Decoded<T> = LoadResult<T> & { blockReason?: string };

/** Runs `migrate[from]` .. `migrate[to - 1]` over `data`, or says why it couldn't. */
function migrateData(
  data: unknown,
  from: number,
  to: number,
  migrate: Migrations,
): { ok: true; data: unknown } | { ok: false; error: string } {
  let current = data;
  for (let v = from; v < to; v++) {
    const step = migrate[v];
    if (!step) return { ok: false, error: `No migration from v${v} to v${v + 1}` };
    try {
      current = step(current);
    } catch (err) {
      return { ok: false, error: `Migration v${v} to v${v + 1} threw: ${String(err)}` };
    }
  }
  return { ok: true, data: current };
}

export async function createSaveStore<T>(options: SaveStoreOptions<T>): Promise<SaveStore<T>> {
  const { gameId, version, schema, migrate = {} } = options;
  const backend = await openBackend(gameId);
  let status: SaveStatus = backend.memory ? "memory-only" : "best-effort";
  if (!backend.memory && (await navigator.storage?.persisted?.())) status = "persistent";
  if (!backend.memory && !(await acquireTabLock(gameId))) status = "read-only";

  /** Slots whose stored data must not be overwritten, with the reason. */
  const blocked = new Map<string, string>();

  function decode(raw: unknown): Decoded<T> {
    if (!isEnvelope(raw)) {
      return {
        kind: "unreadable",
        error: "Stored value is not a save envelope",
        blockReason: "unreadable",
      };
    }
    if (raw.version > version) {
      return {
        kind: "newer-than-code",
        version: raw.version,
        blockReason: `saved by newer code (v${raw.version})`,
      };
    }
    const migrated = migrateData(raw.data, raw.version, version, migrate);
    if (!migrated.ok)
      return { kind: "unreadable", error: migrated.error, blockReason: "unreadable" };
    const parsed = schema.safeParse(migrated.data);
    if (!parsed.success) {
      return {
        kind: "unreadable",
        error: `Save failed validation: ${parsed.error.message}`,
        blockReason: "unreadable",
      };
    }
    return raw.version < version
      ? { kind: "ok", data: parsed.data, migratedFrom: raw.version }
      : { kind: "ok", data: parsed.data };
  }

  const store: SaveStore<T> = {
    get status() {
      return status;
    },

    async load(slot) {
      const raw = await backend.get(slotKey(slot));
      if (raw === undefined) {
        blocked.delete(slot);
        return { kind: "empty" };
      }
      const { blockReason, ...result } = decode(raw);
      if (blockReason) {
        blocked.set(slot, blockReason);
        if (status !== "read-only") await backend.set(`quarantine:${slot}`, raw);
        log.error(`Slot "${slot}" is ${blockReason}; it will not be overwritten`, result);
      } else {
        blocked.delete(slot);
        if (result.kind === "ok" && result.migratedFrom !== undefined && status !== "read-only") {
          await backend.set(`backup:${slot}:v${result.migratedFrom}`, raw);
        }
      }
      return result as LoadResult<T>;
    },

    async save(slot, data) {
      if (status === "read-only") return { ok: false, reason: "Game is open in another tab" };
      const reason = blocked.get(slot);
      if (reason) return { ok: false, reason: `Slot "${slot}" holds a save that is ${reason}` };
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        return { ok: false, reason: `Refusing to write invalid save: ${parsed.error.message}` };
      }
      const envelope: Envelope = { version, savedAt: new Date().toISOString(), data: parsed.data };
      await backend.set(slotKey(slot), envelope);
      return { ok: true };
    },

    async remove(slot) {
      blocked.delete(slot);
      await backend.del(slotKey(slot));
    },

    async slots() {
      return (await backend.keys()).filter((k) => k.startsWith("slot:")).map((k) => k.slice(5));
    },

    async exportJson(slot) {
      const raw = await backend.get(slotKey(slot));
      return raw === undefined ? null : JSON.stringify(raw, null, 2);
    },

    async importJson(slot, json) {
      let raw: unknown;
      try {
        raw = JSON.parse(json);
      } catch {
        return { kind: "unreadable", error: "File is not valid JSON" };
      }
      const { blockReason: _ignored, ...result } = decode(raw);
      if (result.kind === "ok" && status !== "read-only") {
        const envelope: Envelope = {
          version,
          savedAt: new Date().toISOString(),
          data: result.data,
        };
        await backend.set(slotKey(slot), envelope);
        blocked.delete(slot);
      }
      return result as LoadResult<T>;
    },

    async requestPersistence() {
      if (status === "best-effort" && (await navigator.storage?.persist?.())) status = "persistent";
      return status;
    },
  };
  return store;
}

const slotKey = (slot: string) => `slot:${slot}`;

function isEnvelope(raw: unknown): raw is Envelope {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "version" in raw &&
    Number.isInteger((raw as Envelope).version) &&
    "data" in raw
  );
}

async function openBackend(gameId: string): Promise<Backend & { memory: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("indexedDB unavailable");
    const idb: UseStore = createStore(`${gameId}-saves`, "kv");
    await set("__probe", 1, idb);
    await del("__probe", idb);
    return {
      memory: false,
      get: (k) => get(k, idb),
      set: (k, v) => set(k, v, idb),
      del: (k) => del(k, idb),
      keys: async () => (await keys(idb)).map(String),
    };
  } catch (err) {
    log.warn("IndexedDB unavailable, saves will not persist", String(err));
    const mem = new Map<string, unknown>();
    return {
      memory: true,
      get: async (k) => structuredClone(mem.get(k)),
      set: async (k, v) => void mem.set(k, structuredClone(v)),
      del: async (k) => void mem.delete(k),
      keys: async () => [...mem.keys()],
    };
  }
}

/** Holds a Web Lock for the page's lifetime. A second tab of the same game gets read-only saves. */
function acquireTabLock(gameId: string): Promise<boolean> {
  const locks = (globalThis as { navigator?: Navigator }).navigator?.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request(`${gameId}-save-lock`, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}
