package app.notes;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

/**
 * The create request. Bean Validation checks it before the store sees it ({@code @Valid} on the
 * resource method); an unknown field is rejected by the JSON mapper.
 *
 * @param title required, not blank, at most 200 characters
 * @param body optional, at most 10,000 characters
 */
public record NewNote(
        @NotBlank @Size(max = NewNote.MAX_TITLE) String title,
        @Size(max = NewNote.MAX_BODY) @Nullable String body) {

    public static final int MAX_TITLE = 200;
    public static final int MAX_BODY = 10_000;
}
