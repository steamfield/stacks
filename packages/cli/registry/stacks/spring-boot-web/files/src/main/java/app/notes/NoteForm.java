package app.notes;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The add-note form, bound from the posted fields and checked by Bean Validation ({@code @Valid}
 * on the handler). It is a bean rather than a record because Thymeleaf's {@code th:field} reads
 * and the form re-renders through getters. Each message is what the page shows beside the field.
 */
public class NoteForm {

    public static final int MAX_TITLE = 200;
    public static final int MAX_BODY = 10_000;

    @NotBlank(message = "Enter a title.")
    @Size(max = MAX_TITLE, message = "Keep the title to 200 characters or fewer.")
    private String title = "";

    @Size(max = MAX_BODY, message = "Keep the note to 10,000 characters or fewer.")
    private String body = "";

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getBody() {
        return body;
    }

    public void setBody(String body) {
        this.body = body;
    }
}
