package app.errors;

/**
 * A failure the tool reports and exits on. The message is what the user reads; the code decides the
 * exit status and the suggestion.
 */
public final class CliException extends Exception {

    private static final long serialVersionUID = 1L;

    private final ErrorCode code;

    public CliException(ErrorCode code, String message) {
        super(message);
        this.code = code;
    }

    public CliException(ErrorCode code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }

    @Override
    public String getMessage() {
        String message = super.getMessage();
        return message == null ? code.name() : message;
    }
}
