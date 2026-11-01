package app;

import java.io.Serializable;

/**
 * Why a text isn't a slug: one record per rule, with the details a caller needs.
 *
 * <p>The interface is sealed, so a {@code switch} over a {@code SlugError} that covers every record
 * needs no {@code default} branch. Adding a record is a breaking change for those switches, made
 * only in a major release.
 *
 * {@snippet file="app/ExamplesTest.java" region="errors"}
 */
public sealed interface SlugError extends Serializable
        permits SlugError.Empty, SlugError.TooLong, SlugError.InvalidChar, SlugError.MisplacedHyphen {

    /**
     * Describes the problem in words a person reads.
     *
     * @return the message, which names the offending length, character or position
     */
    String message();

    /** The text was empty. */
    record Empty() implements SlugError {
        @Override
        public String message() {
            return "a slug can't be empty";
        }
    }

    /**
     * The text was longer than the rules allow.
     *
     * @param length the text's length in characters
     * @param max the longest length the rules allow
     */
    record TooLong(int length, int max) implements SlugError {
        @Override
        public String message() {
            return "a slug is at most " + max + " characters long, got " + length;
        }
    }

    /**
     * The text held a character other than {@code a-z}, {@code 0-9} and {@code -}.
     *
     * @param codePoint the character, as a Unicode code point
     * @param index its position in the text, counted in {@code char}s from 0
     */
    record InvalidChar(int codePoint, int index) implements SlugError {
        @Override
        public String message() {
            return "invalid character '" + Character.toString(codePoint) + "' at index " + index
                    + "; use a-z, 0-9 and '-'";
        }
    }

    /**
     * A hyphen started or ended the text, or followed another hyphen.
     *
     * @param index the hyphen's position in the text, counted from 0
     */
    record MisplacedHyphen(int index) implements SlugError {
        @Override
        public String message() {
            return "misplaced '-' at index " + index + "; a hyphen goes between two words";
        }
    }
}
