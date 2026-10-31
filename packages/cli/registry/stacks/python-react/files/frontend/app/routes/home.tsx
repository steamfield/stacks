import { RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import { ApiError } from "../lib/api";
import { useHealth } from "../lib/health";

export default function Home() {
  const health = useHealth();
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">API health</h1>
      {health.isPending && <p role="status">Checking API…</p>}
      {health.isError && (
        <p role="alert">
          {health.error instanceof ApiError ? health.error.message : "Could not read API health."}
        </p>
      )}
      {health.isSuccess && <p role="status">API status: {health.data.status}</p>}
      <Button onClick={() => void health.refetch()} disabled={health.isFetching}>
        <RefreshCw aria-hidden="true" size={16} />
        Check again
      </Button>
    </main>
  );
}
