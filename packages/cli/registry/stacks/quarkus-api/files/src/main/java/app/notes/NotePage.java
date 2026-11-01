package app.notes;

import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * One page of notes in creation order.
 *
 * @param items the notes on this page
 * @param nextCursor pass it back unchanged for the next page; null (omitted in JSON) on the last
 */
public record NotePage(List<Note> items, @Nullable String nextCursor) {}
