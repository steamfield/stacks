package app.notes;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/** The form's rules and the messages the page shows for them. */
class NoteFormTest {

    private static final ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
    private static final Validator validator = factory.getValidator();

    @AfterAll
    static void close() {
        factory.close();
    }

    private static Map<String, String> errors(String title, String body) {
        NoteForm form = new NoteForm();
        form.setTitle(title);
        form.setBody(body);
        return validator.validate(form).stream()
                .collect(Collectors.toMap(v -> v.getPropertyPath().toString(), ConstraintViolation::getMessage));
    }

    @Test
    void aTitleAloneIsEnough() {
        assertThat(errors("Groceries", "")).isEmpty();
    }

    @Test
    void eachRuleNamesItsField() {
        assertThat(errors("   ", "")).containsExactly(Map.entry("title", "Enter a title."));
        assertThat(errors("x".repeat(NoteForm.MAX_TITLE + 1), ""))
                .containsOnlyKeys("title")
                .containsValue("Keep the title to 200 characters or fewer.");
        assertThat(errors("t", "x".repeat(NoteForm.MAX_BODY + 1))).containsOnlyKeys("body");
    }
}
