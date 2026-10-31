import type { Route } from "~/routes/+types/healthz";
import { greeting } from "../.server/greeting";
import { cloudflareContext } from "../context";

export function loader({ context }: Route.LoaderArgs) {
  greeting(context.get(cloudflareContext).env);
  return Response.json({ status: "ok" });
}
