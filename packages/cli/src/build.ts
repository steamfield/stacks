/** Build facts supplied to the CLI entry point and defaults for standalone consumers. */
import { HOSTED_API_URL, OFFICIAL_INDEX_URL, OFFICIAL_TELEMETRY_URL } from "./constants";

declare const PACKAGED_ESCAPES: ReadonlyArray<string>;
declare const STACKS_RELEASE_BUILD: boolean;
declare const STACKS_PUBLISHED_TELEMETRY: boolean;

export type Build = {
  readonly releaseBuild: boolean;
  readonly officialApiUrl: string | undefined;
  readonly officialIndexUrl: string | undefined;
  readonly officialTelemetryUrl: string | undefined;
};

export const SOURCE_BUILD: Build = {
  releaseBuild: false,
  officialApiUrl: undefined,
  officialIndexUrl: undefined,
  officialTelemetryUrl: undefined,
};

export const CLI_BUILD: Build = {
  releaseBuild: typeof STACKS_RELEASE_BUILD !== "undefined" && STACKS_RELEASE_BUILD,
  officialApiUrl: HOSTED_API_URL,
  officialIndexUrl: OFFICIAL_INDEX_URL,
  officialTelemetryUrl:
    typeof STACKS_PUBLISHED_TELEMETRY !== "undefined" && STACKS_PUBLISHED_TELEMETRY
      ? OFFICIAL_TELEMETRY_URL
      : undefined,
};

// Source runs read the registry's original filenames.
export const packagedEscapes = typeof PACKAGED_ESCAPES === "undefined" ? [] : PACKAGED_ESCAPES;
