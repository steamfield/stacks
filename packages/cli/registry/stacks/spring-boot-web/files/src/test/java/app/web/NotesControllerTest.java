package app.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;

import app.config.AppProperties;
import app.notes.InMemoryNoteStore;
import java.io.UnsupportedEncodingException;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

/**
 * The pages through the real filter, security chain, controller, advice, templates and store,
 * without a server. Each case reads the rendered HTML, so a template error fails here.
 */
@WebMvcTest(NotesController.class)
@Import({InMemoryNoteStore.class, SecurityConfig.class, NotesControllerTest.Settings.class})
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD) // a fresh, empty store per test
class NotesControllerTest {

    /** A web slice loads no configuration properties; the controller needs the real ones. */
    @TestConfiguration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AppProperties.class)
    static class Settings {}

    @Autowired
    private MockMvcTester mvc;

    private MvcTestResult post(String title, boolean htmx) {
        var request = mvc.post()
                .uri("/notes")
                .with(csrf())
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("title", title)
                .param("body", "");
        return (htmx ? request.header(NotesController.HTMX_HEADER, "true") : request).exchange();
    }

    private static Document html(MvcTestResult result) throws UnsupportedEncodingException {
        return Jsoup.parse(result.getResponse().getContentAsString());
    }

    private static String body(MvcTestResult result) throws UnsupportedEncodingException {
        return result.getResponse().getContentAsString();
    }

    @Test
    void theHomePageRendersTheLayoutTheFormAndItsCsrfToken() throws Exception {
        MvcTestResult result = mvc.get().uri("/").exchange();
        assertThat(result).hasStatusOk().hasContentTypeCompatibleWith(MediaType.TEXT_HTML);
        Document page = html(result);
        assertThat(page.title()).isEqualTo("Notes");
        // The template names no version; the WebJars resolver writes the installed one into the link.
        assertThat(page.select("script[src^='/webjars/htmx.org/'][src$='/dist/htmx.min.js']"))
                .hasSize(1);
        assertThat(page.select("form[action='/notes'][hx-post='/notes'][hx-target='#notes']"))
                .hasSize(1);
        assertThat(page.select("form input[type=hidden][name=_csrf]").attr("value"))
                .isNotBlank();
        assertThat(page.select("li.empty").text()).isEqualTo("No notes yet.");
    }

    @Test
    void anHtmxPostGetsOnlyTheNotesFragmentWithTheNewNote() throws Exception {
        MvcTestResult result = post("  From htmx  ", true);
        assertThat(result).hasStatusOk();
        assertThat(body(result)).doesNotContain("<html", "<header");
        Document fragment = html(result);
        assertThat(fragment.select("section#notes .saved").text()).isEqualTo("Saved From htmx.");
        assertThat(fragment.select("ul.notes a").text()).isEqualTo("From htmx");
        assertThat(fragment.select("input[name=title]").val()).isEmpty();
    }

    @Test
    void anInvalidHtmxPostReRendersTheFragmentWithFieldErrors() throws Exception {
        MvcTestResult result = post("   ", true);
        assertThat(result).hasStatusOk();
        Document fragment = html(result);
        assertThat(fragment.select("section#notes")).hasSize(1);
        assertThat(fragment.select("header")).isEmpty();
        assertThat(fragment.select("p.error").text()).isEqualTo("Enter a title.");
        assertThat(fragment.select("input[name=title]").hasClass("invalid")).isTrue();
        assertThat(fragment.select("li.empty")).hasSize(1);
    }

    @Test
    void aPlainPostRedirectsHomeWithTheSavedMessage() throws Exception {
        MvcTestResult saved = post("From a form", false);
        assertThat(saved).hasStatus(HttpStatus.FOUND).hasRedirectedUrl("/");
        assertThat(saved).flash().containsEntry("saved", "From a form");

        Document home = html(mvc.get().uri("/").exchange());
        assertThat(home.select("ul.notes a").text()).isEqualTo("From a form");
    }

    @Test
    void anInvalidPlainPostReRendersTheWholePageKeepingTheInput() throws Exception {
        MvcTestResult result = post("x".repeat(201), false);
        assertThat(result).hasStatusOk();
        Document page = html(result);
        assertThat(page.select("header")).hasSize(1);
        assertThat(page.select("p.error").text()).isEqualTo("Keep the title to 200 characters or fewer.");
        assertThat(page.select("input[name=title]").val()).hasSize(201);
    }

    @Test
    void aPostWithoutTheCsrfTokenIsRefused() throws Exception {
        MvcTestResult result = mvc.post()
                .uri("/notes")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("title", "forged")
                .exchange();
        assertThat(result).hasStatus(HttpStatus.FORBIDDEN);
        assertThat(html(mvc.get().uri("/").exchange()).select("li.empty")).hasSize(1);
    }

    @Test
    void eachNoteHasItsOwnPage() throws Exception {
        post("Readable", false);
        String href = html(mvc.get().uri("/").exchange()).select("ul.notes a").attr("href");
        Document page = html(mvc.get().uri(href).exchange());
        assertThat(page.title()).isEqualTo("Readable");
        assertThat(page.select("h1").text()).isEqualTo("Readable");
    }

    @Test
    void missesAndWrongMethodsRenderTheErrorPage() throws Exception {
        for (String uri : new String[] {"/notes/missing", "/nothing-here"}) {
            MvcTestResult miss = mvc.get().uri(uri).exchange();
            assertThat(miss).hasStatus(HttpStatus.NOT_FOUND);
            assertThat(html(miss).select("h1").text()).isEqualTo("Page not found");
        }
        MvcTestResult wrongMethod = mvc.get().uri("/notes").exchange();
        assertThat(wrongMethod).hasStatus(HttpStatus.METHOD_NOT_ALLOWED);
        assertThat(wrongMethod.getResponse().getHeader(HttpHeaders.ALLOW)).contains("POST");
        assertThat(html(wrongMethod).select("h1").text()).isEqualTo("Method not allowed");
    }

    @Test
    void requestIdIsKeptWhenWellFormedAndReplacedWhenNot() {
        assertThat(mvc.get().uri("/").header(RequestLogFilter.REQUEST_ID, "abc-123"))
                .hasHeader(RequestLogFilter.REQUEST_ID, "abc-123");
        MvcTestResult replaced = mvc.get()
                .uri("/")
                .header(RequestLogFilter.REQUEST_ID, "bad id\nwith newline")
                .exchange();
        assertThat(replaced.getResponse().getHeader(RequestLogFilter.REQUEST_ID))
                .matches("[0-9a-f-]{36}");
    }
}
