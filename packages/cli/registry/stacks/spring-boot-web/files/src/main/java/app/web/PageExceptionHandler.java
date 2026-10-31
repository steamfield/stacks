package app.web;

import app.errors.AppException;
import app.errors.ErrorCode;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.servlet.ModelAndView;

/**
 * Turns every failure inside Spring MVC into the error page. {@link AppException} carries its own
 * row; the framework's own exceptions (an unknown path, a wrong method with its {@code Allow}
 * header, a missing parameter) carry a status, which picks the row; anything else is a 500 whose
 * class and stack frames are logged. Failures outside Spring MVC reach {@link ErrorPageController}.
 */
@ControllerAdvice
public class PageExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(PageExceptionHandler.class);

    @ExceptionHandler(AppException.class)
    ModelAndView handleApp(AppException e) {
        log.atDebug()
                .addKeyValue("status", e.code().status())
                .addKeyValue("detail", e.getMessage())
                .log("request failed");
        return ErrorPages.page(e.code());
    }

    @ExceptionHandler(Exception.class)
    ModelAndView handleOther(Exception e, HttpServletResponse response) {
        if (e instanceof ErrorResponse rejected) {
            ErrorCode code = ErrorCode.forStatus(rejected.getStatusCode().value());
            for (Map.Entry<String, List<String>> header : rejected.getHeaders().headerSet()) {
                for (String value : header.getValue()) {
                    response.addHeader(header.getKey(), value);
                }
            }
            log.atDebug().addKeyValue("status", code.status()).log("request rejected by the framework");
            return ErrorPages.page(code);
        }
        log.atError()
                .addKeyValue("exception", e.getClass().getName())
                .addKeyValue("stack", ErrorPages.stackFrames(e))
                .log("unexpected failure");
        return ErrorPages.page(ErrorCode.INTERNAL);
    }
}
