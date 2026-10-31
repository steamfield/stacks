import { ConfigProvider, Effect, Layer, Logger, ManagedRuntime, References } from "effect";
import { AppConfig, environment, levels } from "./config";
import { type LogEntry, makeLogger, writer } from "./logging";
import { Health } from "./services/health";

const application = (write?: (record: LogEntry) => void) =>
  Layer.mergeAll(
    Health.layer,
    Layer.unwrap(
      Effect.gen(function* () {
        const config = yield* AppConfig;
        return Layer.mergeAll(
          Logger.layer([makeLogger(write ?? writer(config))]),
          Layer.succeed(References.MinimumLogLevel, levels[config.logLevel]),
        );
      }),
    ),
  ).pipe(Layer.provideMerge(AppConfig.layer));
export const AppLayer = application();

export function makeRuntime(provider = environment(), write?: (record: LogEntry) => void) {
  const layer = write === undefined ? AppLayer : application(write);
  return ManagedRuntime.make(layer.pipe(Layer.provide(ConfigProvider.layer(provider))));
}
export type AppRuntime = ReturnType<typeof makeRuntime>;
export type AppServices = Layer.Success<typeof AppLayer>;
let current: AppRuntime | undefined;
export function getRuntime() {
  current ??= makeRuntime();
  return current;
}
// Tests own the replacement's disposal and restore the previous lazy runtime.
export function setRuntime(runtime: AppRuntime) {
  const previous = current;
  current = runtime;
  return () => {
    current = previous;
  };
}
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    await current?.dispose();
    current = undefined;
  });
}
