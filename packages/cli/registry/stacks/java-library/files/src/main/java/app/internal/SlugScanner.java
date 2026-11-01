package app.internal;

import app.SlugError;
import java.util.Optional;

/** Checks text against the slug rules and reports the first one it breaks. */
public final class SlugScanner {

    private SlugScanner() {}

    /**
     * The first rule {@code input} breaks, checked in order: empty, too long, then each character
     * from the start.
     */
    public static Optional<SlugError> firstProblem(CharSequence input, int maxLength) {
        int length = input.length();
        if (length == 0) {
            return Optional.of(new SlugError.Empty());
        }
        if (length > maxLength) {
            return Optional.of(new SlugError.TooLong(length, maxLength));
        }
        char previous = 0;
        for (int index = 0; index < length; index++) {
            char ch = input.charAt(index);
            if (ch == '-') {
                if (index == 0 || index == length - 1 || previous == '-') {
                    return Optional.of(new SlugError.MisplacedHyphen(index));
                }
            } else if (!isWordChar(ch)) {
                return Optional.of(new SlugError.InvalidChar(Character.codePointAt(input, index), index));
            }
            previous = ch;
        }
        return Optional.empty();
    }

    /** Whether {@code ch} may appear inside a word: {@code a-z} or {@code 0-9}. */
    private static boolean isWordChar(char ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    }
}
