import { listItems } from "@/lib/server/items";
import { logEvent } from "@/lib/server/logging";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const items = await listItems();
  logEvent("health", requestId);
  return Response.json(
    { status: "ok", items: items.length },
    {
      status: 200,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
