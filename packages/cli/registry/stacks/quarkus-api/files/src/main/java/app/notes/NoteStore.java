package app.notes;

import java.util.Optional;
import org.jspecify.annotations.Nullable;

/** Where notes live. A database store implements this and replaces {@link InMemoryNoteStore}. */
public interface NoteStore {

    /** Stores a validated create request and returns the note with its new id. */
    Note create(NewNote input);

    /** The note with this id, if there is one. */
    Optional<Note> find(String id);

    /**
     * Up to {@code limit} notes after {@code cursor} (null for the first page).
     *
     * @throws app.errors.AppException {@code BAD_INPUT} when the cursor isn't one this store issued
     */
    NotePage list(int limit, @Nullable String cursor);
}
