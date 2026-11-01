package app.notes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.errors.AppException;
import app.errors.ErrorCode;
import org.junit.jupiter.api.Test;

class InMemoryNoteStoreTest {

    private final InMemoryNoteStore store = new InMemoryNoteStore();

    @Test
    void createTrimsTheTitleAndDefaultsTheBody() {
        Note note = store.create(new NewNote("  Title  ", null));
        assertThat(note.title()).isEqualTo("Title");
        assertThat(note.body()).isEmpty();
        assertThat(store.find(note.id())).contains(note);
        assertThat(store.find("missing")).isEmpty();
    }

    @Test
    void listWalksEveryNoteOnceInCreationOrder() {
        for (int i = 0; i < 5; i++) {
            store.create(new NewNote("note " + i, "body"));
        }
        NotePage first = store.list(2, null);
        NotePage second = store.list(2, first.nextCursor());
        NotePage last = store.list(2, second.nextCursor());
        assertThat(first.items()).extracting(Note::title).containsExactly("note 0", "note 1");
        assertThat(second.items()).extracting(Note::title).containsExactly("note 2", "note 3");
        assertThat(last.items()).extracting(Note::title).containsExactly("note 4");
        assertThat(last.nextCursor()).isNull();
    }

    @Test
    void anEmptyStoreListsNothing() {
        NotePage page = store.list(20, null);
        assertThat(page.items()).isEmpty();
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void cursorsTheStoreDidNotIssueAreBadInput() {
        store.create(new NewNote("only", null));
        for (String cursor : new String[] {"%%%", "bm90", "bjo5OQ", "bjow", ""}) {
            assertThatThrownBy(() -> store.list(1, cursor))
                    .isInstanceOfSatisfying(
                            AppException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.BAD_INPUT));
        }
    }
}
