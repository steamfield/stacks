// Shared by the form (app/) and the POST route (server/), imported as #shared/schemas/note.
import { z } from "zod";

export const NOTE_MAX = 200;

export const NoteInput = z.object({
  text: z
    .string({ error: "Enter a note." })
    .trim()
    .min(1, { error: "Enter a note." })
    .max(NOTE_MAX, { error: `Use at most ${NOTE_MAX} characters.` }),
});

export type NoteInput = z.infer<typeof NoteInput>;

export type Note = { id: string; text: string; createdAt: string };

/** Field name to its first message, the shape the 400 response carries in data.fields. */
export type FieldErrors = Partial<Record<keyof NoteInput, string>>;

export function fieldErrors(error: z.ZodError<NoteInput>): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key === "text" && fields.text === undefined) fields.text = issue.message;
  }
  return fields;
}
