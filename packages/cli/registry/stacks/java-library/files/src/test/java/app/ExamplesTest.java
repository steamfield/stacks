package app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * The examples the Javadoc shows. Each region between {@code @start} and {@code @end} is pulled into
 * a type's documentation by {@code {@snippet file="app/ExamplesTest.java" region="..."}}, so every
 * example in the docs compiles and passes here.
 */
class ExamplesTest {

    @Test
    void parse() {
        // @start region="parse"
        Slug slug = Slug.parse("release-notes-2026");
        assertThat(slug.value()).isEqualTo("release-notes-2026");
        assertThat(slug).isEqualTo(Slug.parse("release-notes-2026"));
        // @end
    }

    @Test
    void rules() {
        // @start region="rules"
        SlugRules shortSlugs = SlugRules.withMaxLength(8);
        assertThat(shortSlugs.parse("v2-notes").value()).isEqualTo("v2-notes");
        assertThat(shortSlugs.check("release-notes")).hasValue(new SlugError.TooLong(13, 8));
        assertThat(SlugRules.defaults().check("release-notes")).isEmpty();
        // @end
    }

    @Test
    void errors() {
        // @start region="errors"
        String hint;
        try {
            hint = "saved as " + Slug.parse("Release Notes");
        } catch (SlugException e) {
            hint = switch (e.error()) {
                case SlugError.Empty() -> "type a name";
                case SlugError.TooLong(var length, var max) -> "remove " + (length - max) + " characters";
                case SlugError.InvalidChar(var codePoint, var index) ->
                    "replace '" + Character.toString(codePoint) + "' at " + index;
                case SlugError.MisplacedHyphen(var index) -> "move the hyphen at " + index;
            };
        }
        assertThat(hint).isEqualTo("replace 'R' at 0");
        // @end
    }
}
