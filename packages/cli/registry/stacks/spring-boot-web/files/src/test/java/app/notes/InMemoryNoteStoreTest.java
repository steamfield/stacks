package app.notes;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class InMemoryNoteStoreTest {

    private final InMemoryNoteStore store = new InMemoryNoteStore();

    private static NoteForm form(String title, String body) {
        NoteForm form = new NoteForm();
        form.setTitle(title);
        form.setBody(body);
        return form;
    }

    @Test
    void createTrimsTheTitleAndKeepsTheBody() {
        Note note = store.create(form("  Title  ", "line one\nline two"));
        assertThat(note.title()).isEqualTo("Title");
        assertThat(note.body()).isEqualTo("line one\nline two");
        assertThat(store.find(note.id())).contains(note);
        assertThat(store.find("missing")).isEmpty();
    }

    @Test
    void newestListsTheLatestNotesFirstUpToTheLimit() {
        for (int i = 0; i < 4; i++) {
            store.create(form("note " + i, ""));
        }
        assertThat(store.newest(3)).extracting(Note::title).containsExactly("note 3", "note 2", "note 1");
        assertThat(store.newest(10)).hasSize(4);
    }

    @Test
    void anEmptyStoreListsNothing() {
        assertThat(store.newest(50)).isEmpty();
    }
}
