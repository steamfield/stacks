package app;

import static org.assertj.core.api.Assertions.assertThat;

import app.web.RequestLogFilter;
import java.net.ServerSocket;
import java.net.URI;
import java.util.Map;
import org.htmlunit.WebClient;
import org.htmlunit.html.HtmlButton;
import org.htmlunit.html.HtmlForm;
import org.htmlunit.html.HtmlPage;
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

/** The whole application on a random port: a browser without JavaScript, then plain HTTP. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
@ExtendWith(OutputCaptureExtension.class)
class WebIT {

    @Autowired
    private RestTestClient client;

    @LocalServerPort
    private int port;

    private String base() {
        return "http://127.0.0.1:" + port;
    }

    @Test
    void aBrowserWithoutJavaScriptAddsANoteThroughTheRealForm(CapturedOutput output) throws Exception {
        try (WebClient browser = new WebClient()) {
            browser.getOptions().setJavaScriptEnabled(false);
            browser.getOptions().setCssEnabled(false);
            browser.addRequestHeader(RequestLogFilter.REQUEST_ID, "it-browser");

            HtmlPage home = browser.getPage(base() + "/");
            HtmlForm form = home.getFirstByXPath("//form[@action='/notes']");
            form.getInputByName("title").setValue("From the browser");
            form.getTextAreaByName("body").setText("Hello");
            HtmlButton submit = form.getFirstByXPath(".//button[@type='submit']");
            HtmlPage after = submit.click();

            // POST, redirect, GET: the browser lands back on the home page with the message.
            assertThat(after.getUrl().toString()).isEqualTo(base() + "/");
            assertThat(after.querySelector(".saved").getTextContent()).isEqualTo("Saved From the browser.");
            HtmlPage note = after.getAnchorByText("From the browser").click();
            assertThat(note.getTitleText()).isEqualTo("From the browser");
        }
        // One JSON access record per request, carrying the request id, the route and the status.
        assertThat(output.getOut())
                .containsPattern("\"requestId\":\"it-browser\"")
                .containsPattern("\"route\":\"/notes\"")
                .containsPattern("\"status\":302");
    }

    @Test
    void htmxAndTheStylesheetAreServed() {
        client.get()
                .uri("/webjars/htmx.org/dist/htmx.min.js")
                .exchange()
                .expectStatus()
                .isOk()
                .expectHeader()
                .contentTypeCompatibleWith("text/javascript");
        client.get()
                .uri("/css/site.css")
                .exchange()
                .expectStatus()
                .isOk()
                .expectHeader()
                .contentTypeCompatibleWith("text/css");
    }

    @Test
    void failuresOutsideSpringMvcRenderTheErrorPage() {
        // Spring Security refuses a post without the CSRF token before any controller runs.
        client.post()
                .uri("/notes")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body("title=forged")
                .exchange()
                .expectStatus()
                .isForbidden()
                .expectBody(String.class)
                .value(html -> assertThat(html).contains("<h1>Forbidden</h1>"));
        client.get()
                .uri("/nothing-here")
                .exchange()
                .expectStatus()
                .isNotFound()
                .expectBody(String.class)
                .value(html -> assertThat(html).contains("<h1>Page not found</h1>"));
    }

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
