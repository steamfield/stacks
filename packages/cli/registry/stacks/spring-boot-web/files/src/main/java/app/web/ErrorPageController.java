package app.web;

import app.errors.ErrorCode;
import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.servlet.ModelAndView;

/**
 * Replaces Spring Boot's {@code /error} page, which the servlet container forwards to when a
 * failure happens outside Spring MVC (a refused CSRF token in Spring Security's filters, say), so
 * those answers are the same error page.
 */
@Controller
public class ErrorPageController implements ErrorController {

    private static final Logger log = LoggerFactory.getLogger(ErrorPageController.class);

    @RequestMapping("${server.error.path:/error}")
    ModelAndView error(HttpServletRequest request) {
        if (request.getAttribute(RequestDispatcher.ERROR_EXCEPTION) instanceof Throwable e) {
            log.atError()
                    .addKeyValue("exception", e.getClass().getName())
                    .addKeyValue("stack", ErrorPages.stackFrames(e))
                    .log("unexpected failure outside Spring MVC");
        }
        return ErrorPages.page(ErrorCode.forStatus(status(request)));
    }

    private static int status(HttpServletRequest request) {
        return request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer status ? status : 500;
    }
}
