package app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.CharBuffer;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class SlugTest {

    @Test
    void parseUsesTheDefaultRules() {
        String tooLong = "a".repeat(SlugRules.DEFAULT_MAX_LENGTH + 1);
        assertThatThrownBy(() -> Slug.parse(tooLong))
                .isInstanceOfSatisfying(
                        SlugException.class, e -> assertThat(e.error()).isInstanceOf(SlugError.TooLong.class));
    }

    @Test
    void inputIsUsedAsIs() {
        assertThatThrownBy(() -> Slug.parse(" notes")).isInstanceOf(SlugException.class);
        assertThatThrownBy(() -> Slug.parse("Notes")).isInstanceOf(SlugException.class);
        assertThat(Slug.parse(CharBuffer.wrap("notes")).value()).isEqualTo("notes");
    }

    @Test
    void slugsAreValuesOfTheirText() {
        Slug slug = Slug.parse("release-notes");
        assertThat(slug)
                .isEqualTo(Slug.parse("release-notes"))
                .hasSameHashCodeAs(Slug.parse("release-notes"))
                .hasToString("release-notes")
                .isNotEqualTo(Slug.parse("release"))
                .isNotEqualTo("release-notes");
    }

    @Test
    void slugsSortByTheirText() {
        List<Slug> sorted = Stream.of("b", "a-b", "a").map(Slug::parse).sorted().toList();
        assertThat(sorted).extracting(Slug::value).containsExactly("a", "a-b", "b");
    }
}
