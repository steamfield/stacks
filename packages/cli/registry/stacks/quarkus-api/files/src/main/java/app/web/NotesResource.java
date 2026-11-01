package app.web;

import app.config.AppConfig;
import app.errors.AppException;
import app.errors.ErrorCode;
import app.notes.NewNote;
import app.notes.Note;
import app.notes.NotePage;
import app.notes.NoteStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.net.URI;
import org.jboss.resteasy.reactive.RestResponse;
import org.jspecify.annotations.Nullable;

/** {@code /v1/notes}: create, read and list. HTTP only; the store owns the rules. */
@Path("/v1/notes")
@Produces(MediaType.APPLICATION_JSON)
public class NotesResource {

    private final NoteStore store;
    private final AppConfig config;

    public NotesResource(NoteStore store, AppConfig config) {
        this.store = store;
        this.config = config;
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public RestResponse<Note> create(@Valid @NotNull NewNote input) {
        Note note = store.create(input);
        return RestResponse.ResponseBuilder.<Note>created(URI.create("/v1/notes/" + note.id()))
                .entity(note)
                .build();
    }

    @GET
    @Path("/{noteId}")
    public Note get(@PathParam("noteId") String noteId) {
        return store.find(noteId).orElseThrow(() -> new AppException(ErrorCode.NOT_FOUND, "no such note"));
    }

    @GET
    public NotePage list(@QueryParam("limit") @Nullable String limit, @QueryParam("cursor") @Nullable String cursor) {
        return store.list(pageSize(limit), cursor);
    }

    /** The requested page size, or the default; anything else than 1 to the maximum is BAD_INPUT. */
    private int pageSize(@Nullable String limit) {
        if (limit == null) {
            return config.defaultPageSize();
        }
        try {
            int size = Integer.parseInt(limit);
            if (size >= 1 && size <= config.maxPageSize()) {
                return size;
            }
        } catch (NumberFormatException e) {
            // Not a number: the same answer as a number out of range.
        }
        throw new AppException(ErrorCode.BAD_INPUT, "limit out of range");
    }
}
