import { ArrowRight } from "lucide-react";
import { data, Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "~/routes/+types/home";
import { runData } from "../.server/http";
import { greet, home } from "../.server/programs";
import { Button } from "../components/ui/button";

export async function loader({ request }: Route.LoaderArgs) {
  const result = await runData(request, home);
  return data(result.value, { headers: result.headers });
}
export async function action({ request }: Route.ActionArgs) {
  const result = await runData(request, greet(request));
  return data(result.value, { headers: result.headers });
}
// Document responses need explicit forwarding of loader/action/error headers.
export function headers({ loaderHeaders, actionHeaders, errorHeaders }: Route.HeadersArgs) {
  const result = new Headers(loaderHeaders);
  for (const source of [actionHeaders, errorHeaders]) {
    source?.forEach((value, key) => {
      result.set(key, value);
    });
  }
  return result;
}
export default function Home() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Server greeting</h1>
      <p role="status">{submitted?.message ?? loaded.message}</p>
      <Form method="post" className="space-y-4">
        <label className="block" htmlFor="name">
          Your name
        </label>
        <input
          className="block w-full rounded-md border border-stone-400 bg-white px-3 py-2"
          id="name"
          name="name"
          required
          maxLength={64}
        />
        <Button type="submit" disabled={navigation.state !== "idle"}>
          Greet <ArrowRight aria-hidden size={16} />
        </Button>
      </Form>
    </main>
  );
}
