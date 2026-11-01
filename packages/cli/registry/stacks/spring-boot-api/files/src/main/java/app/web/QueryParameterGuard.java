package app.web;

import app.errors.AppException;
import app.errors.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Rejects, with the 400 envelope, a query parameter the handler doesn't declare with
 * {@code @RequestParam} and a parameter given more than once. Spring MVC would ignore the first
 * and silently pick one value of the second.
 */
public class QueryParameterGuard implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        Set<String> declared = declared(method);
        for (Map.Entry<String, String[]> parameter : request.getParameterMap().entrySet()) {
            if (!declared.contains(parameter.getKey())) {
                throw new AppException(ErrorCode.BAD_INPUT, "unknown query parameter");
            }
            if (parameter.getValue().length > 1) {
                throw new AppException(ErrorCode.BAD_INPUT, "repeated query parameter");
            }
        }
        return true;
    }

    private static Set<String> declared(HandlerMethod method) {
        Set<String> names = new HashSet<>();
        for (MethodParameter parameter : method.getMethodParameters()) {
            RequestParam annotation = parameter.getParameterAnnotation(RequestParam.class);
            if (annotation != null) {
                names.add(annotation.name().isEmpty() ? annotation.value() : annotation.name());
            }
        }
        return names;
    }
}
