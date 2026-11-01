package app.web;

import app.config.AppProperties;
import app.errors.AppException;
import app.errors.ErrorCode;
import app.notes.Note;
import app.notes.NoteForm;
import app.notes.NoteStore;
import jakarta.validation.Valid;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

/**
 * The notes pages: the home page lists the newest notes under the add form, and each note has its
 * own page. A form post from htmx ({@code HX-Request}) gets back only the {@code notes} fragment
 * it swaps in; a plain browser post gets the whole page, or a redirect after a save (POST,
 * redirect, GET), so the page works with JavaScript off.
 */
@Controller
public class NotesController {

    static final String INDEX = "notes/index";
    static final String NOTES_FRAGMENT = INDEX + " :: notes";
    static final String HTMX_HEADER = "HX-Request";

    private static final Logger log = LoggerFactory.getLogger(NotesController.class);

    private final NoteStore store;
    private final AppProperties properties;

    public NotesController(NoteStore store, AppProperties properties) {
        this.store = store;
        this.properties = properties;
    }

    @GetMapping("/")
    public String index(Model model) {
        model.addAttribute("noteForm", new NoteForm());
        return listing(model, INDEX);
    }

    @PostMapping("/notes")
    public String create(
            @Valid @ModelAttribute("noteForm") NoteForm form,
            BindingResult result,
            @RequestHeader(name = HTMX_HEADER, required = false) @Nullable String htmx,
            Model model,
            RedirectAttributes redirect) {
        boolean partial = "true".equals(htmx);
        if (result.hasErrors()) {
            // The bound form goes back with its errors; 200, so htmx of any version swaps it in.
            return listing(model, partial ? NOTES_FRAGMENT : INDEX);
        }
        Note note = store.create(form);
        log.atInfo().addKeyValue("noteId", note.id()).log("note created");
        if (partial) {
            model.addAttribute("noteForm", new NoteForm());
            model.addAttribute("saved", note.title());
            return listing(model, NOTES_FRAGMENT);
        }
        redirect.addFlashAttribute("saved", note.title());
        return "redirect:/";
    }

    @GetMapping("/notes/{noteId}")
    public String show(@PathVariable("noteId") String noteId, Model model) {
        Note note = store.find(noteId).orElseThrow(() -> new AppException(ErrorCode.NOT_FOUND, "no such note"));
        model.addAttribute("note", note);
        return "notes/show";
    }

    private String listing(Model model, String view) {
        model.addAttribute("notes", store.newest(properties.pageSize()));
        return view;
    }
}
