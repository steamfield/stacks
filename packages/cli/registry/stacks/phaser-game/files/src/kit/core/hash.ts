/**
 * A generic, deterministic state hasher: 32-bit FNV-1a over a tagged walk of plain data, so two
 * runs (or two browsers) can be compared with one number. Every value kind writes a tag byte
 * before its content, so `[1]`, `{0: 1}` and `"1"` cannot produce the same bytes.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const TAG = {
  undefined: 0,
  null: 1,
  boolean: 2,
  number: 3,
  string: 4,
  array: 5,
  set: 6,
  object: 7,
} as const;

const DOUBLE_BYTES = 8;
/** Scratch space for one double. Written little-endian whatever the CPU's own byte order is. */
const doubleView = new DataView(new ArrayBuffer(DOUBLE_BYTES));

/** A running FNV-1a hash that bytes are fed into. */
interface ByteSink {
  byte(value: number): void;
  hash(): number;
}

function createByteSink(): ByteSink {
  let state = FNV_OFFSET_BASIS;
  return {
    byte(value) {
      state = Math.imul(state ^ value, FNV_PRIME);
    },
    hash: () => state >>> 0,
  };
}

const ROOT_PATH = "(root)";

/** Options for {@link hashState}. */
export interface HashStateOptions {
  /** Keys of the top-level object to leave out. Nested objects with the same keys are still hashed. */
  skipKeys?: ReadonlySet<string>;
}

/**
 * A 32-bit unsigned hash of a plain-data value, equal for equal content whatever order object keys
 * were added in.
 *
 * Supports `undefined`, `null`, booleans, numbers (including `-0` and `NaN`), strings, arrays, sets
 * of only numbers or only strings, and plain objects. Object fields holding `undefined` count as
 * absent.
 *
 * @throws {TypeError} When the value holds something there is no hashing rule for (a function,
 *   symbol, bigint, Map or class instance), a set of mixed members, or a container that contains
 *   itself, naming its path.
 */
export function hashState(value: unknown, options: HashStateOptions = {}): number {
  const sink = createByteSink();
  writeValue(sink, withoutSkippedKeys(value, options.skipKeys), "", new Set());
  return sink.hash();
}

/** A shallow copy of a top-level plain object without `skipKeys`; any other value is returned as is. */
function withoutSkippedKeys(value: unknown, skipKeys: ReadonlySet<string> | undefined): unknown {
  if (!skipKeys || !isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !skipKeys.has(key)));
}

/**
 * Writes one value by its kind. `open` holds the containers on the way down to it, so a value that
 * contains itself is reported instead of walked forever.
 */
function writeValue(sink: ByteSink, value: unknown, path: string, open: Set<object>): void {
  if (value === undefined) sink.byte(TAG.undefined);
  else if (value === null) sink.byte(TAG.null);
  else if (typeof value === "boolean") writeBoolean(sink, value);
  else if (typeof value === "number") writeNumber(sink, value);
  else if (typeof value === "string") writeString(sink, value);
  else if (Array.isArray(value))
    writeContainer(value, path, open, () => writeArray(sink, value, path, open));
  else if (value instanceof Set) writeSet(sink, value, path);
  else if (isPlainObject(value))
    writeContainer(value, path, open, () => writeObject(sink, value, path, open));
  else throw new TypeError(`hashState: no rule for ${describeKind(value)} at ${path || ROOT_PATH}`);
}

/** Runs `write` for a container, refusing one that is already open above it. */
function writeContainer(container: object, path: string, open: Set<object>, write: () => void) {
  if (open.has(container)) throw new TypeError(`hashState: a cycle at ${path || ROOT_PATH}`);
  open.add(container);
  write();
  open.delete(container);
}

function writeBoolean(sink: ByteSink, value: boolean): void {
  sink.byte(TAG.boolean);
  sink.byte(value ? 1 : 0);
}

/** The canonical quiet NaN, little-endian. */
const NAN_BYTES = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f] as const;

function writeNumber(sink: ByteSink, value: number): void {
  sink.byte(TAG.number);
  // Every NaN is written as these fixed bytes and never through setFloat64, since the spec lets an
  // engine store any NaN bit pattern there, even for the Number.NaN constant.
  if (Number.isNaN(value)) {
    for (const byte of NAN_BYTES) sink.byte(byte);
    return;
  }
  doubleView.setFloat64(0, value, true);
  for (let index = 0; index < DOUBLE_BYTES; index++) sink.byte(doubleView.getUint8(index));
}

/** Writes the length then each UTF-16 code unit as two bytes, so neighbouring strings can't merge. */
function writeString(sink: ByteSink, value: string): void {
  sink.byte(TAG.string);
  writeCount(sink, value.length);
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    sink.byte(unit & 0xff);
    sink.byte(unit >>> 8);
  }
}

function writeCount(sink: ByteSink, count: number): void {
  for (let shift = 0; shift < 32; shift += 8) sink.byte((count >>> shift) & 0xff);
}

function writeArray(sink: ByteSink, items: readonly unknown[], path: string, open: Set<object>) {
  sink.byte(TAG.array);
  writeCount(sink, items.length);
  // An indexed loop, so a hole in a sparse array is written as undefined and the count stays true.
  for (let index = 0; index < items.length; index++)
    writeValue(sink, items[index], joinPath(path, String(index)), open);
}

function writeSet(sink: ByteSink, members: Set<unknown>, path: string): void {
  sink.byte(TAG.set);
  writeCount(sink, members.size);
  for (const member of sortedMembers(members, path)) writeValue(sink, member, path, new Set());
}

function sortedMembers(members: Set<unknown>, path: string): unknown[] {
  const items = [...members];
  if (items.every((item) => typeof item === "number")) return items.sort(compareNumbers);
  if (items.every((item) => typeof item === "string")) return items.sort();
  throw new TypeError(`hashState: the set at ${path} must hold only numbers or only strings`);
}

/** Ascending, with NaN after every number, so the order is total and no engine's sort disagrees. */
function compareNumbers(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  return a - b;
}

function writeObject(
  sink: ByteSink,
  fields: Record<string, unknown>,
  path: string,
  open: Set<object>,
): void {
  const keys = Object.keys(fields)
    .filter((key) => fields[key] !== undefined)
    .sort();
  sink.byte(TAG.object);
  writeCount(sink, keys.length);
  for (const key of keys) {
    writeString(sink, key);
    writeValue(sink, fields[key], joinPath(path, key), open);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function describeKind(value: unknown): string {
  if (typeof value === "object") {
    return `an instance of ${value?.constructor?.name ?? "an unnamed class"}`;
  }
  return `a ${typeof value}`;
}
