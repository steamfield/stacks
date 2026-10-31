package app.web;

import app.errors.AppException;
import app.errors.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestResponse;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

/**
 * Turns every failure inside Quarkus REST into the error envelope: the application's own
 * {@link AppException}, the framework's rejections (an unknown path, a wrong method, an unsupported
 * content type), malformed or unknown JSON, failed validation and anything unexpected. Detail goes
 * to the log, never to the client.
 */
public class ErrorMappers {

    private static final Logger log = Logger.getLogger(ErrorMappers.class);

    @ServerExceptionMapper
    public RestResponse<ErrorEnvelope> app(AppException e) {
        log.debugf("request failed: tag=%s detail=%s", e.code().tag(), e.getMessage());
        return envelope(e.code());
    }

    @ServerExceptionMapper
    public RestResponse<ErrorEnvelope> framework(WebApplicationException e) {
        int status = e.getResponse().getStatus();
        ErrorCode code = ErrorCode.forStatus(status);
        log.debugf("request rejected by the framework: tag=%s status=%d", code.tag(), status);
        return envelope(code);
    }

    // MismatchedInputException (a wrong type, an unknown field) is named because Quarkus ships its own mapper for it.
    @ServerExceptionMapper({JsonProcessingException.class, MismatchedInputException.class})
    public RestResponse<ErrorEnvelope> json(JsonProcessingException e) {
        // The parser's message quotes the client's input, so only the class is logged.
        log.debugf("request body rejected: %s", e.getClass().getSimpleName());
        return envelope(ErrorCode.BAD_INPUT);
    }

    @ServerExceptionMapper
    public RestResponse<ErrorEnvelope> invalid(ConstraintViolationException e) {
        log.debugf(
                "request failed validation: %d violations",
                e.getConstraintViolations().size());
        return envelope(ErrorCode.BAD_INPUT);
    }

    @ServerExceptionMapper
    public RestResponse<ErrorEnvelope> unexpected(Exception e) {
        // The class and stack frames only: an exception's message can carry request data.
        log.errorf("unexpected failure: exception=%s stack=%s", e.getClass().getName(), stackFrames(e));
        return envelope(ErrorCode.INTERNAL);
    }

    private static RestResponse<ErrorEnvelope> envelope(ErrorCode code) {
        return RestResponse.ResponseBuilder.<ErrorEnvelope>create(code.status())
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(ErrorEnvelope.of(code))
                .build();
    }

    private static String stackFrames(Throwable e) {
        StringBuilder frames = new StringBuilder();
        for (StackTraceElement frame : e.getStackTrace()) {
            frames.append(frame).append('\n');
        }
        return frames.toString();
    }
}
