// Liveness for stacks verify and the e2e server: process state only, never cached.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "cache-control", "no-store");
  return { status: "ok", notes: (await listNotes()).length };
});
