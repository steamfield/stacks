import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useApp } from "../../providers";

export const queryKeys = { info: ["app-info"] };

function Info() {
  const { transport } = useApp();
  const info = useQuery({
    queryKey: queryKeys.info,
    queryFn: async () => {
      const result = await transport.appInfo();
      if (result.status === "error")
        throw new Error(`Application metadata unavailable (${result.error.kind})`);
      return result.data;
    },
  });
  if (info.error) return <p role="alert">{info.error.message}</p>;
  if (!info.data) return <p>Loading application information...</p>;
  return (
    <p>
      {info.data.name} · {info.data.version} · {info.data.os}
    </p>
  );
}

export function ConnectionStatus() {
  const { ticks } = useApp();
  const status = useStore(ticks, (state) => state.status);
  return (
    <p role="status" aria-label="Connection">
      {status}
    </p>
  );
}

export function Ticks() {
  const { ticks } = useApp();
  const tick = useStore(ticks, (state) => state.tick);
  return (
    <section aria-label="Live ticks">
      <p>
        Tick: <output aria-label="Tick counter">{tick?.counter ?? "not available"}</output>
      </p>
      <p>Elapsed: {tick ? `${tick.elapsed_ms} ms` : "not available"}</p>
    </section>
  );
}

export function MainRoute() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Application information</h1>
      <Info />
      <ConnectionStatus />
      <Ticks />
    </main>
  );
}
