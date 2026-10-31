import { fieldErrors, NoteInput } from "#shared/schemas/note";

// A public endpoint: anyone can POST any body, so the shared schema runs here every time.
export default defineEventHandler(async (event) => {
  const parsed = await readValidatedBody(event, (body) => NoteInput.safeParse(body));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid note",
      data: { fields: fieldErrors(parsed.error) },
    });
  }
  const note = await addNote(parsed.data.text);
  log("info", "note-added", { requestId: event.context.requestId });
  setResponseStatus(event, 201);
  return { note };
});
