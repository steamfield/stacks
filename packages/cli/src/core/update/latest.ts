/**
 * Asks the npm registry for the newest published version of stacks. This is the only network
 * request `stacks update` makes.
 *
 * `update.ts::update` calls `latestVersion` once. The registry's answer is untrusted text, so its
 * `version` field is decoded with `version.ts::Version` before it can reach output or the
 * `npm install` argument list. Every way the request can go wrong (no connection, a non-2xx
 * status, a body that isn't JSON, a version that doesn't decode, the deadline passing) becomes the
 * same `UpstreamUnavailable` failure, carrying the HTTP status when there was one.
 */
import { Duration, Effect, Option, Schema } from "effect";
import { HttpClient } from "effect/http";
import { UpstreamUnavailable } from "../../errors";
import { PACKAGE } from "../../version";
import { Version } from "./version";

/** The registry's "latest" document for a package, reduced to the one field read. */
const LatestDocument = Schema.Struct({ version: Version });

/** The registry URL; the scoped name's `/` is escaped as npm expects. */
const LATEST_URL = `https://registry.npmjs.org/${PACKAGE.replace("/", "%2f")}/latest`;

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

/** One bounded request, with upstream text decoded before it can enter output or argv. */
export const latestVersion = Effect.fn("update.latestVersion")(function* (
  timeout = Duration.seconds(10),
) {
  const client = yield* HttpClient.HttpClient;
  const result = yield* fetchLatest(client).pipe(Effect.scoped, Effect.timeoutOption(timeout));
  if (Option.isNone(result)) return yield* unavailable();
  return result.value;
});
