package app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import org.junit.jupiter.api.Test;

/**
 * Properties that hold for every generated input, not only the cases written out. The seed is fixed,
 * so a failure names its input and reproduces on every run; change the seed to explore further.
 */
class SlugPropertiesTest {

    private static final int RUNS = 2_000;
    private static final String ALPHABET = "abcxyz0189-_ AZé😀";

    private final Random random = new Random(20_261_031L);

    @Test
    void anyTextParsesOrFailsWithItsFirstProblem() {
        for (int run = 0; run < RUNS; run++) {
            String input = text(random.nextInt(12));
            Optional<SlugError> problem = SlugRules.defaults().check(input);
            try {
                assertThat(Slug.parse(input).value()).as(input).isEqualTo(input);
                assertThat(problem).as(input).isEmpty();
            } catch (SlugException e) {
                assertThat(problem).as(input).hasValue(e.error());
            }
        }
    }

    @Test
    void wordsJoinedByHyphensAlwaysParse() {
        for (int run = 0; run < RUNS; run++) {
            String input = String.join("-", words());
            assertThat(Slug.parse(input).value()).as(input).isEqualTo(input);
        }
    }

    @Test
    void exactlyTheTextsWithinTheMaximumParse() {
        for (int run = 0; run < RUNS; run++) {
            int max = 1 + random.nextInt(20);
            String input = String.join("-", words());
            assertThat(SlugRules.withMaxLength(max).check(input).isEmpty())
                    .as("%s with max %d", input, max)
                    .isEqualTo(input.length() <= max);
        }
    }

    private String text(int length) {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < length; i++) {
            text.appendCodePoint(ALPHABET.codePointAt(
                    ALPHABET.offsetByCodePoints(0, random.nextInt(ALPHABET.codePointCount(0, ALPHABET.length())))));
        }
        return text.toString();
    }

    private List<String> words() {
        List<String> words = new ArrayList<>();
        int count = 1 + random.nextInt(6);
        for (int i = 0; i < count; i++) {
            StringBuilder word = new StringBuilder();
            int length = 1 + random.nextInt(6);
            for (int j = 0; j < length; j++) {
                int pick = random.nextInt(36);
                word.append(pick < 26 ? (char) ('a' + pick) : (char) ('0' + pick - 26));
            }
            words.add(word.toString());
        }
        return words;
    }
}
