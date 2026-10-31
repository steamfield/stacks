package app.errors;

/**
 * The one error table: each code's HTTP status, the tag clients branch on, a fixed safe message
 * and whether retrying can help. Never rename a tag; add a code instead.
 */
public enum ErrorCode {
    BAD_INPUT(400, "BadInput", "The request is invalid.", false),
    NOT_FOUND(404, "NotFound", "Resource not found.", false),
    METHOD_NOT_ALLOWED(405, "MethodNotAllowed", "This method is not allowed on this resource.", false),
    NOT_ACCEPTABLE(406, "NotAcceptable", "The response can only be JSON.", false),
    UNSUPPORTED_MEDIA_TYPE(415, "UnsupportedMediaType", "The request body must be JSON.", false),
    INTERNAL(500, "Internal", "Internal error.", false),
    UNAVAILABLE(503, "Unavailable", "The service is unavailable; try again.", true);

    private final int status;
    private final String tag;
    private final String message;
    private final boolean retryable;

    ErrorCode(int status, String tag, String message, boolean retryable) {
        this.status = status;
        this.tag = tag;
        this.message = message;
        this.retryable = retryable;
    }

    public int status() {
        return status;
    }

    public String tag() {
        return tag;
    }

    public String message() {
        return message;
    }

    public boolean retryable() {
        return retryable;
    }

    /** The code for a status the framework chose: an exact row, else 400 for 4xx and 500 for the rest. */
    public static ErrorCode forStatus(int status) {
        for (ErrorCode code : values()) {
            if (code.status == status) {
                return code;
            }
        }
        return status >= 400 && status < 500 ? BAD_INPUT : INTERNAL;
    }
}
