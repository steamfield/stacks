package app.notes;

import app.errors.AppException;
import app.errors.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

/** Notes in memory, erased on restart. The cursor is the position of the next note, encoded. */
@Component
public class InMemoryNoteStore implements NoteStore {

    private final List<Note> notes = new ArrayList<>();
    private final Map<String, Note> byId = new HashMap<>();

    @Override
    public synchronized Note create(NewNote input) {
        String body = input.body();
        Note note = new Note(UUID.randomUUID().toString(), input.title().strip(), body == null ? "" : body);
        notes.add(note);
        byId.put(note.id(), note);
        return note;
    }

    @Override
    public synchronized Optional<Note> find(String id) {
        return Optional.ofNullable(byId.get(id));
    }

    @Override
    public synchronized NotePage list(int limit, @Nullable String cursor) {
        int from = cursor == null ? 0 : decode(cursor);
        int to = Math.min(notes.size(), from + limit);
        List<Note> items = List.copyOf(notes.subList(from, to));
        return new NotePage(items, to < notes.size() ? encode(to) : null);
    }

    private static String encode(int position) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(("n:" + position).getBytes(StandardCharsets.UTF_8));
    }

    private int decode(String cursor) {
        try {
            String text = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            if (text.startsWith("n:")) {
                int position = Integer.parseInt(text.substring(2));
                if (position > 0 && position <= notes.size()) {
                    return position;
                }
            }
        } catch (IllegalArgumentException e) {
            // Not base64 or not a number: the same answer as an out-of-range position.
        }
        throw new AppException(ErrorCode.BAD_INPUT, "unknown cursor");
    }
}
