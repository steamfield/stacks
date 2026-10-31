import { describe, expect, it } from "vitest";
import { fieldErrors, NOTE_MAX, NoteInput } from "./note";

function errorsFor(body: unknown) {
  const parsed = NoteInput.safeParse(body);
  if (parsed.success) throw new Error("expected a validation failure");
  return fieldErrors(parsed.error);
}

describe("NoteInput", () => {
  it("trims accepted text", () => {
    expect(NoteInput.parse({ text: "  Read the code  " })).toEqual({
      text: "Read the code",
    });
  });

  it.each([
    [{ text: "   " }, "Enter a note."],
    [{}, "Enter a note."],
    [{ text: 42 }, "Enter a note."],
    [{ text: "x".repeat(NOTE_MAX + 1) }, `Use at most ${NOTE_MAX} characters.`],
  ])("rejects %j with one field message", (body, message) => {
    expect(errorsFor(body)).toEqual({ text: message });
  });

  it("drops unknown keys", () => {
    expect(NoteInput.parse({ text: "ok", admin: true })).toEqual({ text: "ok" });
  });
});
