/**
 * The DOM-free core every layer shares: the event log, state hash, logger, seeded rng, save types
 * and fixed timestep. `src/logic/` may import this folder and zod, nothing else.
 */
export { type BaseEvent, type Drained, EventLog, type EventSink, type Stamped } from "./events.ts";
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
