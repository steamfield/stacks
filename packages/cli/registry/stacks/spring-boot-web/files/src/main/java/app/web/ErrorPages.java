package app.web;

import app.errors.ErrorCode;
import org.springframework.http.HttpStatusCode;
import org.springframework.web.servlet.ModelAndView;

/** The error page for a row of the error table: the {@code error} template with that row's status. */
final class ErrorPages {

    static final String VIEW = "error";

    private ErrorPages() {}

    static ModelAndView page(ErrorCode code) {
        ModelAndView page = new ModelAndView(VIEW, HttpStatusCode.valueOf(code.status()));
        page.addObject("code", code);
        return page;
    }

    /** The class and stack frames only: an exception's message can carry request data. */
    static String stackFrames(Throwable e) {
        StringBuilder frames = new StringBuilder();
        for (StackTraceElement frame : e.getStackTrace()) {
            frames.append(frame).append('\n');
        }
        return frames.toString();
    }
}
