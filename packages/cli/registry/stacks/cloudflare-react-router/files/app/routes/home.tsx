import type { Route } from "~/routes/+types/home";
import { greeting } from "../.server/greeting";
import { cloudflareContext } from "../context";

export function loader({ context }: Route.LoaderArgs) {
  return { message: greeting(context.get(cloudflareContext).env) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Worker greeting</h1>
      <p role="status">{loaderData.message}</p>
    </main>
  );
}
