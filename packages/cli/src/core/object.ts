type FieldRecord = Record<PropertyKey, unknown>;
type Defined<T> = T extends FieldRecord
  ? {
      [K in keyof T as undefined extends T[K] ? never : K]: T[K];
    } & {
      [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
    }
  : never;

/** Copies enumerable own fields in order, so callers can omit optional keys before serialization. */
export function defined<const T extends FieldRecord>(fields: T): Defined<T>;
export function defined(fields: FieldRecord): FieldRecord {
  const result = { ...fields };
  for (const key of Reflect.ownKeys(result)) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}
