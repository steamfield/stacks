package app;

import app.internal.SlugScanner;
import java.util.Optional;

/**
 * The rules a slug must follow: not empty, at most {@link #maxLength()} characters, only {@code
 * a-z} and {@code 0-9}, and a hyphen only between two of those.
 *
 * <p>Rules are immutable and safe to share between threads.
 *
 * {@snippet file="app/ExamplesTest.java" region="rules"}
 */
public final class SlugRules {

    /** The maximum length the default rules allow. */
    public static final int DEFAULT_MAX_LENGTH = 64;

    private static final SlugRules DEFAULTS = new SlugRules(DEFAULT_MAX_LENGTH);

    private final int maxLength;

    private SlugRules(int maxLength) {
        this.maxLength = maxLength;
    }

    /**
     * Returns the default rules, which allow up to {@value #DEFAULT_MAX_LENGTH} characters.
     *
     * @return the default rules
     */
    public static SlugRules defaults() {
        return DEFAULTS;
    }

    /**
     * Returns rules that allow up to {@code maxLength} characters.
     *
     * @param maxLength the longest slug to accept, at least 1
     * @return the rules
     * @throws IllegalArgumentException if {@code maxLength} is less than 1
     */
    public static SlugRules withMaxLength(int maxLength) {
        if (maxLength < 1) {
            throw new IllegalArgumentException("maxLength must be at least 1, got " + maxLength);
        }
        return new SlugRules(maxLength);
    }

    /**
     * Returns the longest slug these rules accept.
     *
     * @return the maximum length in characters
     */
    public int maxLength() {
        return maxLength;
    }

    /**
     * Finds the first rule {@code input} breaks, without throwing.
     *
     * @param input the text to check
     * @return the first problem, or empty when {@code input} is a valid slug
     */
    public Optional<SlugError> check(CharSequence input) {
        return SlugScanner.firstProblem(input, maxLength);
    }

    /**
     * Parses {@code input} as a slug under these rules.
     *
     * @param input the text to check, used as is: nothing is trimmed or lowercased
     * @return the slug
     * @throws SlugException if {@code input} breaks a rule; {@link SlugException#error()} says which
     */
    public Slug parse(CharSequence input) {
        Optional<SlugError> problem = check(input);
        if (problem.isPresent()) {
            throw new SlugException(problem.get());
        }
        return Slug.checked(input.toString());
    }

    /**
     * Rules are equal when they allow the same maximum length.
     *
     * @param other the object to compare with
     * @return whether {@code other} is rules with the same maximum length
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof SlugRules rules && maxLength == rules.maxLength;
    }

    /**
     * Returns a hash of the maximum length.
     *
     * @return the hash code
     */
    @Override
    public int hashCode() {
        return Integer.hashCode(maxLength);
    }

    /**
     * Describes the rules for logs and test failures.
     *
     * @return {@code SlugRules[maxLength=N]}
     */
    @Override
    public String toString() {
        return "SlugRules[maxLength=" + maxLength + "]";
    }
}
