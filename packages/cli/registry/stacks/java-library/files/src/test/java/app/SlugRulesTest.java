package app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SlugRulesTest {

    @Test
    void acceptsWordsJoinedBySingleHyphens() {
        for (String input : List.of("a", "java", "java-25", "a-b-c", "0")) {
            assertThat(SlugRules.defaults().parse(input).value()).as(input).isEqualTo(input);
            assertThat(SlugRules.defaults().check(input)).as(input).isEmpty();
        }
    }

    @Test
    void reportsTheFirstRuleBroken() {
        SlugRules rules = SlugRules.withMaxLength(5);
        Map<String, SlugError> cases = Map.of(
                "", new SlugError.Empty(),
                "abcdef", new SlugError.TooLong(6, 5),
                "-ab", new SlugError.MisplacedHyphen(0),
                "ab-", new SlugError.MisplacedHyphen(2),
                "a--b", new SlugError.MisplacedHyphen(2),
                "aB", new SlugError.InvalidChar('B', 1),
                "a b", new SlugError.InvalidChar(' ', 1),
                "é", new SlugError.InvalidChar('é', 0),
                "a😀", new SlugError.InvalidChar(0x1F600, 1));
        cases.forEach((input, expected) -> {
            assertThat(rules.check(input)).as(input).hasValue(expected);
            assertThatThrownBy(() -> rules.parse(input))
                    .as(input)
                    .isInstanceOfSatisfying(
                            SlugException.class, e -> assertThat(e.error()).isEqualTo(expected))
                    .hasMessage(expected.message());
        });
    }

    @Test
    void lengthIsCheckedBeforeCharacters() {
        assertThat(SlugRules.withMaxLength(2).check("ABC")).hasValue(new SlugError.TooLong(3, 2));
    }

    @Test
    void theDefaultMaxLengthIsInclusive() {
        String longest = "a".repeat(SlugRules.DEFAULT_MAX_LENGTH);
        assertThat(Slug.parse(longest).value()).hasSize(SlugRules.DEFAULT_MAX_LENGTH);
        assertThat(SlugRules.defaults().check(longest + "a"))
                .hasValue(new SlugError.TooLong(SlugRules.DEFAULT_MAX_LENGTH + 1, SlugRules.DEFAULT_MAX_LENGTH));
    }

    @Test
    void maxLengthMustBePositive() {
        assertThatThrownBy(() -> SlugRules.withMaxLength(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("maxLength must be at least 1, got 0");
        assertThat(SlugRules.withMaxLength(1).maxLength()).isEqualTo(1);
    }

    @Test
    void rulesAreValues() {
        assertThat(SlugRules.withMaxLength(SlugRules.DEFAULT_MAX_LENGTH))
                .isEqualTo(SlugRules.defaults())
                .hasSameHashCodeAs(SlugRules.defaults())
                .hasToString("SlugRules[maxLength=64]");
        assertThat(SlugRules.withMaxLength(5)).isNotEqualTo(SlugRules.defaults());
    }
}
