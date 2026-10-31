package app.notes;

/**
 * A stored note.
 *
 * @param id opaque identifier, used in the note's page address
 * @param title trimmed, 1 to 200 characters
 * @param body up to 10,000 characters, empty when the form left it blank
 */
public record Note(String id, String title, String body) {}
