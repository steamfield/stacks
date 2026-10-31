package app.notes;

/**
 * A stored note, the one shape every route returns.
 *
 * @param id opaque identifier
 * @param title trimmed, 1 to 200 characters
 * @param body up to 10,000 characters, empty when the create request had none
 */
public record Note(String id, String title, String body) {}
