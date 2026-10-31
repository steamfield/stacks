import { createServer } from "node:net";
import { defineConfig, devices } from "@playwright/test";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No browser test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return String(address.port);
}

// Workers load this config again; inherit the server's selected port.
const port = process.env.TAURI_E2E_PORT ?? (await freePort());
process.env.TAURI_E2E_PORT = port;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `make dev-web PORT_WEB=${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
