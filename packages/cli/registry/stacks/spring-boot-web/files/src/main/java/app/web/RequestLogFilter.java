package app.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * The outermost filter, ahead of Spring Security. Keeps a well-formed incoming {@code X-Request-Id}
 * or makes one, puts it in the MDC (so every log line of the request carries {@code requestId})
 * and on the response, and logs one record per request with whether htmx sent it.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLogFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID = "X-Request-Id";
    static final String MDC_KEY = "requestId";
    private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private static final Logger log = LoggerFactory.getLogger(RequestLogFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = requestId(request.getHeader(REQUEST_ID));
        long started = System.nanoTime();
        MDC.put(MDC_KEY, requestId);
        response.setHeader(REQUEST_ID, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            // The route pattern, never the raw path or query, which can carry client data.
            Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
            log.atInfo()
                    .addKeyValue("method", request.getMethod())
                    .addKeyValue("route", route == null ? "unmatched" : route.toString())
                    .addKeyValue("status", response.getStatus())
                    .addKeyValue("htmx", "true".equals(request.getHeader(NotesController.HTMX_HEADER)))
                    .addKeyValue("durationMs", (System.nanoTime() - started) / 1_000_000)
                    .log("request");
            MDC.remove(MDC_KEY);
        }
    }

    /** The client's id when it is safe to log and echo, else a new UUID. */
    static String requestId(@Nullable String incoming) {
        return incoming != null && VALID_ID.matcher(incoming).matches()
                ? incoming
                : UUID.randomUUID().toString();
    }
}
