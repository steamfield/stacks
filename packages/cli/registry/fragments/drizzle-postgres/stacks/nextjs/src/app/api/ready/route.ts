import { isReady } from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Readiness: 200 when Postgres answers, 503 otherwise. Never includes the error text.
export async function GET() {
  const requestId = crypto.randomUUID();
  const ready = await isReady();
  return Response.json(
    { status: ready ? "ready" : "unavailable" },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
