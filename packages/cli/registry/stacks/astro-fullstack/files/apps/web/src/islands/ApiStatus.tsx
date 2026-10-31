import { useEffect, useState } from "react";
import { health } from "../lib/api";

type Status = Awaited<ReturnType<typeof health>>;

export default function ApiStatus() {
  const [attempt, setAttempt] = useState(0);
  return <Status key={attempt} retry={() => setAttempt(attempt + 1)} />;
}

function Status({ retry }: { retry: () => void }) {
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    const controller = new AbortController();
    setStatus(undefined);
    void health(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setStatus(value);
      },
      () => {
        if (!controller.signal.aborted)
          setStatus({ ok: false, message: "Could not reach the API.", retryable: true });
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <section aria-label="API health">
      <p role="status">{status?.message ?? "Checking API…"}</p>
      {status?.retryable && (
        <button type="button" className="mt-3 underline" onClick={retry}>
          Retry
        </button>
      )}
    </section>
  );
}
