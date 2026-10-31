export function greeting(env: { GREETING?: unknown }): string {
  const value = env.GREETING ?? "Hello from Workers";
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 64) {
    throw new Response("Service unavailable.", { status: 503 });
  }
  return value.trim();
}
