/**
 * The DOM-free core of the game kit: events, the state hash, logging, seeded randomness, the fixed
 * step and save types. src/logic/ may import only this entry and zod.
 */
export {
  type BaseEvent,
  type Drained,
  EventLog,
  type EventSink,
  type Stamped,
} from "./events.ts";
export { type HashStateOptions, hashState } from "./hash.ts";
export {
  configureLogging,
  createLogger,
  type LogEntry,
  type Logger,
  type LogLevel,
  type LogSink,
} from "./logger.ts";
export { createRng, type Rng } from "./rng.ts";
export type { Migration, Migrations, SaveSchema } from "./save-types.ts";
export { FixedStep, TICK_DT, TICK_HZ } from "./timestep.ts";
