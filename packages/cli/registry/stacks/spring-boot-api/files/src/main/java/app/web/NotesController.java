package app.web;

import app.config.AppProperties;
import app.errors.AppException;
import app.errors.ErrorCode;
import app.notes.NewNote;
import app.notes.Note;
import app.notes.NotePage;
import app.notes.NoteStore;
import jakarta.validation.Valid;
import java.net.URI;
import org.jspecify.annotations.Nullable;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** {@code /v1/notes}: create, read and list. HTTP only; the store owns the rules. */
@RestController
@RequestMapping("/v1/notes")
public class NotesController {

    private final NoteStore store;
    private final AppProperties properties;

    public NotesController(NoteStore store, AppProperties properties) {
        this.store = store;
        this.properties = properties;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Note> create(@Valid @RequestBody NewNote input) {
        Note note = store.create(input);
        return ResponseEntity.created(URI.create("/v1/notes/" + note.id())).body(note);
    }

    @GetMapping("/{noteId}")
    public Note get(@PathVariable("noteId") String noteId) {
        return store.find(noteId).orElseThrow(() -> new AppException(ErrorCode.NOT_FOUND, "no such note"));
    }

    @GetMapping
    public NotePage list(
            @RequestParam(name = "limit", required = false) @Nullable Integer limit,
            @RequestParam(name = "cursor", required = false) @Nullable String cursor) {
        int size = limit == null ? properties.defaultPageSize() : limit;
        if (size < 1 || size > properties.maxPageSize()) {
            throw new AppException(ErrorCode.BAD_INPUT, "limit out of range");
        }
        return store.list(size, cursor);
    }
}
