package app.notes;

import java.util.List;
import java.util.Optional;

/** Where notes live. A database store implements this and replaces {@link InMemoryNoteStore}. */
public interface NoteStore {

    /** Stores a validated form and returns the note with its new id. */
    Note create(NoteForm form);

    /** The note with this id, if there is one. */
    Optional<Note> find(String id);

    /** Up to {@code limit} notes, newest first. */
    List<Note> newest(int limit);
}
