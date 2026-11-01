package app.web;

import app.errors.ErrorCode;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Replaces Spring Boot's {@code /error} page, which the servlet container forwards to when a
 * failure happens outside Spring MVC (in a filter, say), so those answers use the envelope too.
 */
@RestController
public class FallbackErrorController implements ErrorController {

    @RequestMapping("${server.error.path:/error}")
    ResponseEntity<ErrorEnvelope> error(HttpServletRequest request) {
        ErrorCode code = ErrorCode.forStatus(status(request));
        return ResponseEntity.status(code.status())
                .contentType(MediaType.APPLICATION_JSON)
                .body(ErrorEnvelope.of(code));
    }

    private static int status(HttpServletRequest request) {
        return request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer status ? status : 500;
    }
}
