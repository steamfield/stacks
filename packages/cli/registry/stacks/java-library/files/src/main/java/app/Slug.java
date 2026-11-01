package app;

/**
 * A validated slug: lowercase ASCII letters and digits, in words joined by single hyphens.
 *
 * <p>A {@code Slug} is immutable, and two slugs are equal when their text is. They sort by their
 * text.
 *
 * {@snippet file="app/ExamplesTest.java" region="parse"}
 */
public final class Slug implements Comparable<Slug> {

    private final String value;

    private Slug(String value) {
        this.value = value;
    }

    /**
     * Parses {@code input} with the {@linkplain SlugRules#defaults() default rules}.
     *
     * @param input the text to check, used as is: nothing is trimmed or lowercased
     * @return the slug
     * @throws SlugException if {@code input} breaks a rule; {@link SlugException#error()} says which
     */
    public static Slug parse(CharSequence input) {
        return SlugRules.defaults().parse(input);
    }

    /** Wraps text the rules already accepted. Only {@link SlugRules#parse} calls it. */
    static Slug checked(String value) {
        return new Slug(value);
    }

    /**
     * Returns the slug's text.
     *
     * @return the text, exactly as it was parsed
     */
    public String value() {
        return value;
    }

    /**
     * Compares slugs by their text.
     *
     * @param other the slug to compare with
     * @return a negative number, zero or a positive number as this slug's text sorts before, equal
     *     to or after {@code other}'s
     */
    @Override
    public int compareTo(Slug other) {
        return value.compareTo(other.value);
    }

    /**
     * Two slugs are equal when their text is.
     *
     * @param other the object to compare with
     * @return whether {@code other} is a slug with the same text
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof Slug slug && value.equals(slug.value);
    }

    /**
     * Returns the text's hash code.
     *
     * @return the hash code
     */
    @Override
    public int hashCode() {
        return value.hashCode();
    }

    /**
     * Returns the slug's text, the same as {@link #value()}.
     *
     * @return the text
     */
    @Override
    public String toString() {
        return value;
    }
}
