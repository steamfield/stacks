package app.web;

import app.errors.AppException;
import app.errors.ErrorCode;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Turns every failure inside Spring MVC into the error envelope. The base class maps the
 * framework's own exceptions (bad JSON, failed validation, a wrong type in the query, an unknown
 * path, a wrong method with its {@code Allow} header, an unsupported content type) to a status;
 * {@link #createResponseEntity} replaces its Problem Details body with the envelope for that
 * status's row. Detail goes to the log, never to the client.
 */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(AppException.class)
    ResponseEntity<Object> handleApp(AppException e) {
        log.atDebug()
                .addKeyValue("tag", e.code().tag())
                .addKeyValue("detail", e.getMessage())
                .log("request failed");
        return envelope(e.code(), HttpHeaders.EMPTY);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> handleUnexpected(Exception e) {
        // The class and stack frames only: an exception's message can carry request data.
        log.atError()
                .addKeyValue("exception", e.getClass().getName())
                .addKeyValue("stack", stackFrames(e))
                .log("unexpected failure");
        return envelope(ErrorCode.INTERNAL, HttpHeaders.EMPTY);
    }

    @Override
    protected ResponseEntity<Object> createResponseEntity(
            @Nullable Object body, HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        ErrorCode code = ErrorCode.forStatus(statusCode.value());
        log.atDebug()
                .addKeyValue("tag", code.tag())
                .addKeyValue("status", statusCode.value())
                .log("request rejected by the framework");
        return envelope(code, headers);
    }

    private static ResponseEntity<Object> envelope(ErrorCode code, HttpHeaders headers) {
        return ResponseEntity.status(code.status())
                .headers(headers)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ErrorEnvelope.of(code));
    }

    private static String stackFrames(Throwable e) {
        StringBuilder frames = new StringBuilder();
        for (StackTraceElement frame : e.getStackTrace()) {
            frames.append(frame).append('\n');
        }
        return frames.toString();
    }
}
