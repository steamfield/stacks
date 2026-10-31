package app;

import static org.assertj.core.api.Assertions.assertThat;

import app.notes.Note;
import app.web.RequestLogFilter;
import java.net.ServerSocket;
import java.net.URI;
import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.client.RestTestClient;

/** The whole application on a random port, called over real HTTP. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
@ExtendWith(OutputCaptureExtension.class)
class ApiIT {

    @Autowired
    private RestTestClient client;

    @LocalServerPort
    private int port;

    @Test
    void healthIsUp() {
        client.get()
                .uri("/actuator/health")
                .exchange()
                .expectStatus()
                .isOk()
                .expectBody()
                .jsonPath("$.status")
                .isEqualTo("UP");
    }

    @Test
    void aNoteRoundTripsAndTheRequestIsLoggedWithItsId(CapturedOutput output) {
        Note created = Objects.requireNonNull(client.post()
                .uri("/v1/notes")
                .contentType(MediaType.APPLICATION_JSON)
                .header(RequestLogFilter.REQUEST_ID, "it-round-trip")
                .body(Map.of("title", "From the test", "body", "Hello"))
                .exchange()
                .expectStatus()
                .isCreated()
                .expectHeader()
                .valueEquals(RequestLogFilter.REQUEST_ID, "it-round-trip")
                .expectBody(Note.class)
                .returnResult()
                .getResponseBody());

        client.get()
                .uri("/v1/notes/{noteId}", created.id())
                .exchange()
                .expectStatus()
                .isOk()
                .expectBody(Note.class)
                .isEqualTo(created);
        client.get()
                .uri("/v1/notes")
                .exchange()
                .expectStatus()
                .isOk()
                .expectBody()
                .jsonPath("$.items[?(@.id == '" + created.id() + "')].title")
                .isEqualTo("From the test");

        // One JSON access record carrying the request id, the route pattern and the status.
        assertThat(output.getOut())
                .containsPattern("\"requestId\":\"it-round-trip\"")
                .containsPattern("\"route\":\"/v1/notes\"")
                .containsPattern("\"status\":201");
    }

    @Test
    void theHealthProbeExitsZeroOnlyWhenTheServerAnswers() throws Exception {
        assertThat(HealthProbe.run(Map.of("HOST", "0.0.0.0", "PORT", Integer.toString(port))))
                .isZero();
        int closed;
        try (ServerSocket socket = new ServerSocket(0)) {
            closed = socket.getLocalPort();
        }
        assertThat(HealthProbe.check(URI.create("http://127.0.0.1:" + closed + "/actuator/health")))
                .isOne();
        assertThat(HealthProbe.target(Map.of("HOST", "::", "PORT", "9"))).hasToString("http://[::1]:9/actuator/health");
    }
}
