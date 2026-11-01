export default defineEventHandler(async () => ({ notes: await listNotes() }));
