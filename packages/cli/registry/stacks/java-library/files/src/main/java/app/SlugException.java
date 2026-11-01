package app;

/**
 * Thrown when text isn't a slug. {@link #error()} says which rule it broke; the message is that
 * error's {@link SlugError#message()}.
 *
 * <p>It is unchecked, like {@link NumberFormatException}: input from a person or a file can fail,
 * and the caller decides where to handle it.
 */
public final class SlugException extends IllegalArgumentException {

    private static final long serialVersionUID = 1L;

    /** The rule the input broke; part of the serialized form. */
    private final SlugError error;

    /**
     * Creates the exception for one broken rule.
     *
     * @param error the rule the input broke
     */
    public SlugException(SlugError error) {
        super(error.message());
        this.error = error;
    }

    /**
     * Returns the rule the input broke.
     *
     * @return the error, with its details
     */
    public SlugError error() {
        return error;
    }
}
