/**
 * Makes update's single request to the npm registry. It decodes the returned version with `Version`
 * before it can reach output or argv.
 */
import { Duration, Effect, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import { NPM_REGISTRY_TIMEOUT_SECONDS, NPM_REGISTRY_URL } from "../../constants";
import { UpstreamUnavailable } from "../../errors";
import { PACKAGE } from "../../version";
import { Version } from "./version";

const LatestDocument = Schema.Struct({ version: Version });

/** The registry URL; the scoped name's `/` is escaped as npm expects. */
const LATEST_URL = `${NPM_REGISTRY_URL}/${PACKAGE.replace("/", "%2f")}/latest`;

const unavailable = (status?: number) =>
  new UpstreamUnavailable({
    details: { service: "npm-registry", ...(status === undefined ? {} : { status }) },
  });

/** One GET of the latest document, decoded; needs a scope for the response. */
const fetchLatest = (client: HttpClient.HttpClient) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.withScope(client)
      .get(LATEST_URL, { headers: { accept: "application/json" } })
      .pipe(Effect.mapError(() => unavailable()));
    if (response.status < 200 || response.status >= 300) return yield* unavailable(response.status);
    const body = yield* response.json.pipe(Effect.mapError(() => unavailable(response.status)));
    const decoded = yield* Schema.decodeUnknownEffect(LatestDocument)(body).pipe(
      Effect.mapError(() => unavailable(response.status)),
    );
    return decoded.version;
  });

/**
 * Report transport, status, decode and deadline failures as `UpstreamUnavailable`. Keep the
 * response status when available.
 */
export const latestVersion = Effect.fn("update.latestVersion")(function* (
  timeout = Duration.seconds(NPM_REGISTRY_TIMEOUT_SECONDS),
) {
  const client = yield* HttpClient.HttpClient;
  const result = yield* fetchLatest(client).pipe(Effect.scoped, Effect.timeoutOption(timeout));
  if (Option.isNone(result)) return yield* unavailable();
  return result.value;
});
