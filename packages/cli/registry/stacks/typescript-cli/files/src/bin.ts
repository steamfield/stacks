import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Schema } from "effect";
import rawMetadata from "../package.json";
import { jsonRequested, main } from "./main";
import { AppLayer, runInvocation } from "./runtime";
import { PackageInfo } from "./schemas/package";
import { Host } from "./services/host";
import type { Writer } from "./services/output";

const writer =
  (stream: NodeJS.WriteStream): Writer =>
  (text) =>
    new Promise((resolve, reject) => {
      stream.write(text, (error) => (error ? reject(error) : resolve()));
    });
// The write callback owns errors; prevent a second uncaught stream error.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const args = process.argv.slice(2);
const metadata = Schema.decodeUnknownSync(PackageInfo)(rawMetadata);
declare const COMPILED: boolean;
const platform = Layer.mergeAll(
  BunServices.layer,
  Host.layer({
    name: metadata.name,
    version: metadata.version ?? "dev",
    platform: process.platform,
    compiled: typeof COMPILED !== "undefined" && COMPILED,
  }),
);
const app = AppLayer(
  process.env,
  jsonRequested(args),
  writer(process.stdout),
  writer(process.stderr),
);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  process.exitCode = await runInvocation(
    main(args).pipe(Effect.provide(app), Effect.provide(platform), Effect.scoped),
    controller.signal,
  );
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
