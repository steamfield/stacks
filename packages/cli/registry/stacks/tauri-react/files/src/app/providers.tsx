import type { Transport } from "@core/transport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { createTickStore } from "../core/tick-store";

const Context = createContext<{
  transport: Transport;
  ticks: ReturnType<typeof createTickStore>;
} | null>(null);

export function Providers({ transport, children }: { transport: Transport; children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [ticks] = useState(createTickStore);
  useEffect(() => {
    let stop = () => {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      stop = transport.subscribeTicks({
        next: (tick) => ticks.setState({ tick, status: "live" }),
        end: () => {
          stop();
          ticks.setState({ status: "reconnecting" });
          retry = setTimeout(connect, 1000);
        },
      });
    };
    connect();
    return () => {
      clearTimeout(retry);
      stop();
    };
  }, [transport, ticks]);
  return (
    <QueryClientProvider client={queryClient}>
      <Context.Provider value={{ transport, ticks }}>{children}</Context.Provider>
    </QueryClientProvider>
  );
}

export function useApp() {
  const app = useContext(Context);
  if (app === null) throw new Error("Providers is missing");
  return app;
}
