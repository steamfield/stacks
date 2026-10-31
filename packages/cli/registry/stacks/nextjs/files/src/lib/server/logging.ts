import "server-only";

export function eventRecord(
  event: "item.added" | "item.rejected" | "health",
  requestId: string,
) {
  return { time: new Date().toISOString(), level: "info", event, requestId };
}

export function logEvent(
  event: Parameters<typeof eventRecord>[0],
  requestId: string,
) {
  // Only allowlisted fields: never form values, environment, headers or raw errors.
  console.info(JSON.stringify(eventRecord(event, requestId)));
}
