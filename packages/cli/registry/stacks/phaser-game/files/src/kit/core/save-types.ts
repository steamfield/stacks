/**
 * Save types that game logic needs. Migrations live in `src/logic/`, which may import only this
 * folder and zod; the IndexedDB implementation is `src/kit/save.ts`.
 */

/** Upgrades save data from version N to N+1. Keyed by the version it upgrades FROM. */
export type Migration = (data: unknown) => unknown;
export type Migrations = Readonly<Record<number, Migration>>;

/** Anything with zod's safeParse shape, so logic can define schemas without importing the store. */
export interface SaveSchema<T> {
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}
