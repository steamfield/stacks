package app;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

import app.web.RequestFilters;
import io.quarkus.test.junit.QuarkusIntegrationTest;
import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The packaged application (target/quarkus-app) started as its own process, called over real HTTP. */
@QuarkusIntegrationTest
class ApiIT {

    /** Where Quarkus writes the launched application's output. */
    private static final Path LOG = Path.of("target", "quarkus.log");

    @Test
    void readinessIsUp() {
        Response health = given().get("/q/health/ready");
        assertThat(health.statusCode()).isEqualTo(200);
        assertThat(health.<String>path("status")).isEqualTo("UP");
    }

    @Test
    void aNoteRoundTripsAndTheRequestIsLoggedWithItsId() throws Exception {
        Response created = given().contentType(ContentType.JSON)
                .header(RequestFilters.REQUEST_ID, "it-round-trip")
                .body("{\"title\":\"From the test\",\"body\":\"Hello\"}")
                .post("/v1/notes");
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(created.header(RequestFilters.REQUEST_ID)).isEqualTo("it-round-trip");
        String id = created.path("id");

        Response read = given().get("/v1/notes/{noteId}", id);
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(read.<String>path("body")).isEqualTo("Hello");
        Response list = given().get("/v1/notes");
        assertThat(list.<List<String>>path("items.id")).contains(id);

        // One JSON access record carrying the request id, the route template and the status.
        assertThat(Files.readString(LOG, StandardCharsets.UTF_8))
                .containsPattern("\"requestId\":\"it-round-trip\"")
                .containsPattern("\"route\":\"/v1/notes\"")
                .containsPattern("\"status\":\"201\"");
    }

    @Test
    void theOpenApiDocumentDescribesTheNotesRoutes() {
        Response document = given().get("/q/openapi?format=json");
        assertThat(document.statusCode()).isEqualTo(200);
        assertThat(document.<Map<String, Object>>path("paths")).containsKeys("/v1/notes", "/v1/notes/{noteId}");
    }

    @Test
    void theHealthProbeExitsZeroOnlyWhenTheServerAnswers() throws Exception {
        assertThat(HealthProbe.run(Map.of("HOST", "0.0.0.0", "PORT", Integer.toString(RestAssured.port))))
                .isZero();
        int closed;
        try (ServerSocket socket = new ServerSocket(0)) {
            closed = socket.getLocalPort();
        }
        assertThat(HealthProbe.check(URI.create("http://127.0.0.1:" + closed + HealthProbe.PATH)))
                .isOne();
        assertThat(HealthProbe.target(Map.of("HOST", "::", "PORT", "9"))).hasToString("http://[::1]:9/q/health/ready");
    }
}
