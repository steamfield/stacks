package app.errors;

/**
 * The one error table: each code's HTTP status and the fixed title and message its error page
 * shows. Nothing a request sent ever reaches the page.
 */
public enum ErrorCode {
    BAD_REQUEST(400, "Bad request", "The request could not be understood."),
    FORBIDDEN(403, "Forbidden", "This request was refused. Reload the page and try again."),
    NOT_FOUND(404, "Page not found", "There is nothing at this address."),
    METHOD_NOT_ALLOWED(405, "Method not allowed", "This page does not accept that kind of request."),
    INTERNAL(500, "Something went wrong", "The server failed to answer. Try again in a moment."),
    UNAVAILABLE(503, "Unavailable", "The service is unavailable. Try again in a moment.");

    private final int status;
    private final String title;
    private final String message;

    ErrorCode(int status, String title, String message) {
        this.status = status;
        this.title = title;
        this.message = message;
    }

    public int status() {
        return status;
    }

    public String title() {
        return title;
    }

    public String message() {
        return message;
    }

    /** The code for a status the framework chose: an exact row, else 400 for 4xx and 500 for the rest. */
    public static ErrorCode forStatus(int status) {
        for (ErrorCode code : values()) {
            if (code.status == status) {
                return code;
            }
        }
        return status >= 400 && status < 500 ? BAD_REQUEST : INTERNAL;
    }
}
