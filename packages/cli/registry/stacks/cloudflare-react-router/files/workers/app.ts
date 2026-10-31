import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/context";
import { scheduled } from "./scheduled";

const handleRequest = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    const response = await handleRequest(request, context);
    console.info(
      JSON.stringify({ event: "request", method: request.method, status: response.status }),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  },
  scheduled,
} satisfies ExportedHandler<Env>;
