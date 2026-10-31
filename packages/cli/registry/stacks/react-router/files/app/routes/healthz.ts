import type { Route } from "~/routes/+types/healthz";
import { runRoute } from "../.server/http";
import { health } from "../.server/programs";

export function loader({ request }: Route.LoaderArgs) {
  return runRoute(request, health);
}
