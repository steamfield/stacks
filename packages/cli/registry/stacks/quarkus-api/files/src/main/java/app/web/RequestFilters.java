package app.web;

import app.errors.AppException;
import app.errors.ErrorCode;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.core.HttpHeaders;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;
import org.jboss.logging.MDC;
import org.jboss.resteasy.reactive.server.ServerRequestFilter;
import org.jboss.resteasy.reactive.server.ServerResponseFilter;
import org.jspecify.annotations.Nullable;

/**
 * Every request's edges. Before matching: keep a well-formed incoming {@code X-Request-Id} or make
 * one and put it in the MDC, so every log line of the request carries {@code requestId}. After
 * matching: reject a query parameter the resource method doesn't declare with {@code @QueryParam},
 * or one given twice. On the response: echo the id, fill {@code Cache-Control: no-store} unless a
 * resource set its own, and log one access record.
 */
public class RequestFilters {

    public static final String REQUEST_ID = "X-Request-Id";
    static final String MDC_KEY = "requestId";
    private static final String STARTED = "app.started";
    private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private static final List<String> RECORD_KEYS = List.of("method", "route", "status", "durationMs");
    private static final Logger log = Logger.getLogger(RequestFilters.class);

    @ServerRequestFilter(preMatching = true)
    public void identify(ContainerRequestContext request) {
        String requestId = requestId(request.getHeaderString(REQUEST_ID));
        request.setProperty(REQUEST_ID, requestId);
        request.setProperty(STARTED, System.nanoTime());
        MDC.put(MDC_KEY, requestId);
    }

    @ServerRequestFilter
    public void guardQuery(ContainerRequestContext request, ResourceInfo resource) {
        Set<String> declared = declared(resource.getResourceMethod());
        for (Map.Entry<String, List<String>> parameter :
                request.getUriInfo().getQueryParameters().entrySet()) {
            if (!declared.contains(parameter.getKey())) {
                throw new AppException(ErrorCode.BAD_INPUT, "unknown query parameter");
            }
            if (parameter.getValue().size() > 1) {
                throw new AppException(ErrorCode.BAD_INPUT, "repeated query parameter");
            }
        }
    }

    @ServerResponseFilter
    public void finish(ContainerRequestContext request, ContainerResponseContext response, ResourceInfo resource) {
        if (request.getProperty(REQUEST_ID) instanceof String requestId) {
            response.getHeaders().putSingle(REQUEST_ID, requestId);
        }
        if (!response.getHeaders().containsKey(HttpHeaders.CACHE_CONTROL)) {
            response.getHeaders().putSingle(HttpHeaders.CACHE_CONTROL, "no-store");
        }
        long started = request.getProperty(STARTED) instanceof Long nanos ? nanos : System.nanoTime();
        // The route template, never the raw path or query, which can carry client data.
        MDC.put("method", request.getMethod());
        MDC.put("route", route(resource));
        MDC.put("status", Integer.toString(response.getStatus()));
        MDC.put("durationMs", Long.toString((System.nanoTime() - started) / 1_000_000));
        try {
            log.info("request");
        } finally {
            RECORD_KEYS.forEach(MDC::remove);
            MDC.remove(MDC_KEY);
        }
    }

    /** The client's id when it is safe to log and echo, else a new UUID. */
    static String requestId(@Nullable String incoming) {
        return incoming != null && VALID_ID.matcher(incoming).matches()
                ? incoming
                : UUID.randomUUID().toString();
    }

    private static Set<String> declared(@Nullable Method method) {
        Set<String> names = new HashSet<>();
        if (method != null) {
            for (Parameter parameter : method.getParameters()) {
                QueryParam annotation = parameter.getAnnotation(QueryParam.class);
                if (annotation != null) {
                    names.add(annotation.value());
                }
            }
        }
        return names;
    }

    private static String route(ResourceInfo resource) {
        Method method = resource.getResourceMethod();
        Class<?> type = resource.getResourceClass();
        if (method == null || type == null) {
            return "unmatched";
        }
        Path base = type.getAnnotation(Path.class);
        Path sub = method.getAnnotation(Path.class);
        return (base == null ? "" : base.value()) + (sub == null ? "" : sub.value());
    }
}
