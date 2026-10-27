import { sep } from "node:path";
import type { Artifact, Location, SarifRun } from "../schemas/sarif";

export function relativizeUri(uri: string | undefined, targetAbs: string): string | undefined {
  if (uri === undefined) return undefined;
  if (uri.startsWith("file://")) {
    const path = uri.slice("file://".length);
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const target = targetAbs.replace(/\\/g, "/");
    if (normalized === target || normalized.startsWith(`${target}/`)) {
      return normalized.slice(target.length + 1);
    }
    return normalized.slice(1);
  }
  return uri;
}

export function rewriteRunUris(run: SarifRun, targetAbs: string): SarifRun {
  const base = `file://${targetAbs.endsWith(sep) ? targetAbs : `${targetAbs}${sep}`}`;
  const originalUriBaseIds = { "%SRCROOT%": { uri: base } };
  const rewrittenArtifacts = Array.isArray(run.artifacts)
    ? run.artifacts.map((a: Artifact) => ({
        ...a,
        location: a.location
          ? { ...a.location, uri: relativizeUri(a.location.uri, targetAbs) }
          : a.location,
      }))
    : run.artifacts;
  const rewrittenResults = Array.isArray(run.results)
    ? run.results.map((r) => {
        const locations = Array.isArray(r.locations)
          ? r.locations.map((loc: Location) => ({
              ...loc,
              physicalLocation: loc.physicalLocation
                ? {
                    ...loc.physicalLocation,
                    artifactLocation: loc.physicalLocation.artifactLocation
                      ? {
                          ...loc.physicalLocation.artifactLocation,
                          uri: relativizeUri(loc.physicalLocation.artifactLocation.uri, targetAbs),
                        }
                      : loc.physicalLocation.artifactLocation,
                  }
                : loc.physicalLocation,
            }))
          : r.locations;
        return { ...r, locations };
      })
    : run.results;
  return {
    ...run,
    originalUriBaseIds,
    artifacts: rewrittenArtifacts,
    results: rewrittenResults,
  };
}
