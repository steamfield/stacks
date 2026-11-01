package app.web;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/**
 * The HTTP contract through the real filters, resource, mappers and store, on a free test port. The
 * application starts once for the class, so tests share the store and never assume it is empty.
 */
@QuarkusTest
class NotesResourceTest {

    private static Response create(String json) {
        return given().contentType(ContentType.JSON).body(json).post("/v1/notes");
    }

    private static void assertError(Response response, int status, String tag) {
        assertThat(response.statusCode()).as(response.asString()).isEqualTo(status);
        assertThat(response.contentType()).startsWith("application/json");
        assertThat(response.<String>path("error.tag")).as(response.asString()).isEqualTo(tag);
        assertThat(response.<String>path("error.message")).isNotBlank();
    }

    @Test
    void createReturns201WithLocationAndTheNote() {
        Response created = create("{\"title\":\"  First  \",\"body\":\"hello\"}");
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(created.<String>path("title")).isEqualTo("First");
        assertThat(created.<String>path("body")).isEqualTo("hello");
        String id = created.path("id");
        assertThat(created.header("Location")).endsWith("/v1/notes/" + id);

        Response read = given().get("/v1/notes/{noteId}", id);
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(read.<String>path("title")).isEqualTo("First");
    }

    @Test
    void invalidBodiesAre400() {
        assertError(create("{\"title\":\"   \"}"), 400, "BadInput");
        assertError(create("{\"body\":\"no title\"}"), 400, "BadInput");
        assertError(create("{\"title\":\"" + "x".repeat(201) + "\"}"), 400, "BadInput");
        assertError(create("{\"title\":\"t\",\"extra\":1}"), 400, "BadInput");
        assertError(create("{\"title\":[1]}"), 400, "BadInput");
        assertError(create("{\"title\":"), 400, "BadInput");
        assertError(create(""), 400, "BadInput");
    }

    @Test
    void aBodyThatIsNotJsonIs415() {
        Response response = given().contentType(ContentType.TEXT).body("title").post("/v1/notes");
        assertError(response, 415, "UnsupportedMediaType");
    }

    @Test
    void listPagesWithAnOpaqueCursor() {
        List<String> mine =
                List.of("page " + System.nanoTime(), "page " + System.nanoTime(), "page " + System.nanoTime());
        for (String title : mine) {
            assertThat(create("{\"title\":\"" + title + "\"}").statusCode()).isEqualTo(201);
        }
        List<String> seen = new ArrayList<>();
        @Nullable String cursor = null;
        do {
            Response page = cursor == null
                    ? given().get("/v1/notes?limit=2")
                    : given().queryParam("limit", 2)
                            .queryParam("cursor", cursor)
                            .get("/v1/notes");
            assertThat(page.statusCode()).isEqualTo(200);
            List<String> titles = page.path("items.title");
            assertThat(titles).hasSizeBetween(1, 2);
            seen.addAll(titles);
            cursor = page.path("nextCursor");
        } while (cursor != null);
        assertThat(seen).endsWith(mine.toArray(String[]::new)).doesNotHaveDuplicates();
    }

    @Test
    void badQueriesAre400() {
        for (String query :
                new String[] {"limit=0", "limit=101", "limit=ten", "cursor=bm90", "sort=title", "limit=1&limit=2"}) {
            assertError(given().get("/v1/notes?" + query), 400, "BadInput");
        }
    }

    @Test
    void missesWrongMethodsAndMediaTypesUseTheEnvelope() {
        assertError(given().get("/v1/notes/missing"), 404, "NotFound");
        assertError(given().get("/v1/nothing-here"), 404, "NotFound");
        assertError(given().delete("/v1/notes"), 405, "MethodNotAllowed");
        assertError(given().accept(ContentType.XML).get("/v1/notes"), 406, "NotAcceptable");
    }

    @Test
    void requestIdIsKeptWhenWellFormedAndReplacedWhenNot() {
        Response kept = given().header(RequestFilters.REQUEST_ID, "abc-123").get("/v1/notes");
        assertThat(kept.header(RequestFilters.REQUEST_ID)).isEqualTo("abc-123");
        assertThat(kept.header("Cache-Control")).isEqualTo("no-store");
        Response replaced = given().header(RequestFilters.REQUEST_ID, "bad id!").get("/v1/notes");
        assertThat(replaced.header(RequestFilters.REQUEST_ID)).matches("[0-9a-f-]{36}");
        assertThat(given().get("/v1/nothing-here").header(RequestFilters.REQUEST_ID))
                .isNotBlank();
    }
}
