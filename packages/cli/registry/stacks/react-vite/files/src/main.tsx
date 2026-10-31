import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createApiClient } from "./api/client";
import { createQueryClient } from "./api/query-client";
import { routes } from "./app/routes";
import { ServicesProvider } from "./app/services";
import { ConfigError, loadConfig } from "./config";
import { createLogger } from "./logging";
import "./styles.css";

function start(container: HTMLElement) {
  const root = createRoot(container);
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // A bad build-time setting: say which one instead of rendering a broken app.
    root.render(<pre className="config-error">{error.message}</pre>);
    return;
  }
  const logger = createLogger(config.logLevel);
  const services = { api: createApiClient({ baseUrl: config.apiUrl, logger }), logger };
  root.render(
    <StrictMode>
      <ServicesProvider services={services}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={createBrowserRouter(routes)} />
        </QueryClientProvider>
      </ServicesProvider>
    </StrictMode>,
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root element");
start(container);
