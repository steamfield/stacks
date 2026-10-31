package app.web;

import static org.assertj.core.api.Assertions.assertThat;

import app.config.AppProperties;
import app.notes.InMemoryNoteStore;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

/** The HTTP contract through the real filter, guard, controller, advice and store, without a server. */
@WebMvcTest(NotesController.class)
@Import({InMemoryNoteStore.class, NotesControllerTest.Settings.class})
class NotesControllerTest {

    /** A web slice loads no configuration properties; the controller needs the real ones. */
    @TestConfiguration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AppProperties.class)
    static class Settings {}

    @Autowired
    private MockMvcTester mvc;

    private MvcTestResult create(String json) {
        return mvc.post()
                .uri("/v1/notes")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json)
                .exchange();
    }

    private static void assertError(MvcTestResult result, HttpStatus status, String tag) {
        assertThat(result)
                .hasStatus(status)
                .hasContentType(MediaType.APPLICATION_JSON)
                .bodyJson()
                .isLenientlyEqualTo("{\"error\":{\"tag\":\"" + tag + "\"}}");
    }

    private static String field(MvcTestResult result, String path) throws Exception {
        return JsonPath.read(result.getResponse().getContentAsString(), path);
    }

    @Test
    void createReturns201WithLocationAndTheNote() throws Exception {
        MvcTestResult result = create("{\"title\":\"  First  \",\"body\":\"hello\"}");
        assertThat(result).hasStatus(HttpStatus.CREATED);
        assertThat(result).bodyJson().extractingPath("$.title").isEqualTo("First");
        assertThat(result).bodyJson().extractingPath("$.body").isEqualTo("hello");
        String id = field(result, "$.id");
        assertThat(result).hasHeader(HttpHeaders.LOCATION, "/v1/notes/" + id);
        assertThat(mvc.get().uri("/v1/notes/" + id))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.title")
                .isEqualTo("First");
    }

    @Test
    void invalidBodiesAre400() {
        assertError(create("{\"title\":\"   \"}"), HttpStatus.BAD_REQUEST, "BadInput");
        assertError(create("{\"body\":\"no title\"}"), HttpStatus.BAD_REQUEST, "BadInput");
        assertError(create("{\"title\":\"" + "x".repeat(201) + "\"}"), HttpStatus.BAD_REQUEST, "BadInput");
        assertError(create("{\"title\":\"t\",\"extra\":1}"), HttpStatus.BAD_REQUEST, "BadInput");
        assertError(create("{\"title\":"), HttpStatus.BAD_REQUEST, "BadInput");
    }

    @Test
    void aBodyThatIsNotJsonIs415() {
        MvcTestResult result = mvc.post()
                .uri("/v1/notes")
                .contentType(MediaType.TEXT_PLAIN)
                .content("title")
                .exchange();
        assertError(result, HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UnsupportedMediaType");
    }

    @Test
    void listPagesWithAnOpaqueCursor() throws Exception {
        for (int i = 0; i < 3; i++) {
            assertThat(create("{\"title\":\"note " + i + "\"}")).hasStatus(HttpStatus.CREATED);
        }
        MvcTestResult first = mvc.get().uri("/v1/notes?limit=2").exchange();
        assertThat(first)
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.items.length()")
                .isEqualTo(2);
        String cursor = field(first, "$.nextCursor");
        MvcTestResult last = mvc.get().uri("/v1/notes?limit=2&cursor=" + cursor).exchange();
        assertThat(last)
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.items[0].title")
                .isEqualTo("note 2");
        assertThat(last).bodyJson().doesNotHavePath("$.nextCursor");
    }

    @Test
    void badQueriesAre400() {
        for (String query :
                new String[] {"limit=0", "limit=101", "limit=ten", "cursor=bm90", "sort=title", "limit=1&limit=2"}) {
            assertError(mvc.get().uri("/v1/notes?" + query).exchange(), HttpStatus.BAD_REQUEST, "BadInput");
        }
    }

    @Test
    void missesAndWrongMethodsUseTheEnvelope() {
        assertError(mvc.get().uri("/v1/notes/missing").exchange(), HttpStatus.NOT_FOUND, "NotFound");
        assertError(mvc.get().uri("/v1/nothing-here").exchange(), HttpStatus.NOT_FOUND, "NotFound");
        MvcTestResult wrongMethod = mvc.delete().uri("/v1/notes").exchange();
        assertError(wrongMethod, HttpStatus.METHOD_NOT_ALLOWED, "MethodNotAllowed");
        assertThat(wrongMethod.getResponse().getHeader(HttpHeaders.ALLOW)).contains("GET", "POST");
    }

    @Test
    void requestIdIsKeptWhenWellFormedAndReplacedWhenNot() {
        assertThat(mvc.get().uri("/v1/notes").header(RequestLogFilter.REQUEST_ID, "abc-123"))
                .hasHeader(RequestLogFilter.REQUEST_ID, "abc-123")
                .hasHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        MvcTestResult replaced = mvc.get()
                .uri("/v1/notes")
                .header(RequestLogFilter.REQUEST_ID, "bad id\nwith newline")
                .exchange();
        assertThat(replaced.getResponse().getHeader(RequestLogFilter.REQUEST_ID))
                .matches("[0-9a-f-]{36}");
    }
}
