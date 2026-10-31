package app.notes;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Notes in memory, erased on restart. */
@Component
public class InMemoryNoteStore implements NoteStore {

    private final List<Note> notes = new ArrayList<>();
    private final Map<String, Note> byId = new HashMap<>();

    @Override
    public synchronized Note create(NoteForm form) {
        Note note = new Note(UUID.randomUUID().toString(), form.getTitle().strip(), form.getBody());
        notes.add(note);
        byId.put(note.id(), note);
        return note;
    }

    @Override
    public synchronized Optional<Note> find(String id) {
        return Optional.ofNullable(byId.get(id));
    }

    @Override
    public synchronized List<Note> newest(int limit) {
        List<Note> page = new ArrayList<>(notes.subList(Math.max(0, notes.size() - limit), notes.size()));
        return List.copyOf(page.reversed());
    }
}
