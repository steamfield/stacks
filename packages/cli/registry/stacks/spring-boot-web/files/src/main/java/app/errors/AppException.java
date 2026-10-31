package app.errors;

/**
 * A failure with a row in {@link ErrorCode}. The detail is for the log only; the error page
 * shows the code's fixed title and message.
 */
public final class AppException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final ErrorCode code;

    public AppException(ErrorCode code, String detail) {
        super(detail);
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }
}
