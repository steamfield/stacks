package consumer;

import app.Slug;
import app.SlugError;
import app.SlugException;
import app.SlugRules;

/** Caller code: turns names into slugs, handling each failure the library reports. */
public final class Names {

    private static final SlugRules SHORT = SlugRules.withMaxLength(16);

    private Names() {}

    /** The slug for {@code name}, or a sentence saying how to fix it. */
    public static String describe(String name) {
        try {
            Slug slug = SHORT.parse(name);
            return "ok: " + slug.value();
        } catch (SlugException e) {
            return switch (e.error()) {
                case SlugError.Empty() -> "empty";
                case SlugError.TooLong(var length, var max) -> "too long: " + length + " > " + max;
                case SlugError.InvalidChar(var codePoint, var index) ->
                    "bad character " + Character.getName(codePoint) + " at " + index;
                case SlugError.MisplacedHyphen(var index) -> "bad hyphen at " + index;
            };
        }
    }
}
