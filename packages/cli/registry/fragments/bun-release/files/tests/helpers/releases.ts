import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** One published release: its tag and its assets by file name. */
export interface StubRelease {
  tag: string;
  assets: Record<string, string | Uint8Array>;
}

export interface StubReleases {
  /** The releases base URL, shaped like https://github.com/<owner>/<repo>/releases. */
  url: string;
  /** Every request path, in order. */
  requests: string[];
  /** Published releases, newest first. Tests may replace them between requests. */
  releases: StubRelease[];
  close: () => Promise<void>;
}

/**
 * A local stand-in for GitHub's release download URLs, on 127.0.0.1 and a free port:
 * `<url>/latest` redirects to `<url>/tag/<tag>`, `<url>/latest/download/<name>` redirects to
 * `<url>/download/<tag>/<name>`, and that serves the asset or 404s. Leave an asset out, or give it
 * other bytes than SHA256SUMS lists, to script a failure.
 */
export async function startStubReleases(releases: StubRelease[]): Promise<StubReleases> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://stub").pathname;
    stub.requests.push(path);
    const latest = stub.releases[0];
    const latestAsset = /^\/releases\/latest\/download\/([^/]+)$/.exec(path);
    const asset = /^\/releases\/download\/([^/]+)\/([^/]+)$/.exec(path);
    let location: string | undefined;
    if (latest && path === "/releases/latest") location = `/releases/tag/${latest.tag}`;
    if (latest && latestAsset) location = `/releases/download/${latest.tag}/${latestAsset[1]}`;
    if (location) {
      response.writeHead(302, { location }).end();
      return;
    }
    const body = asset
      ? stub.releases.find((r) => r.tag === asset[1])?.assets[asset[2] ?? ""]
      : undefined;
    if (body === undefined) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const stub: StubReleases = {
    url: `http://127.0.0.1:${port}/releases`,
    requests: [],
    releases,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
  return stub;
}
