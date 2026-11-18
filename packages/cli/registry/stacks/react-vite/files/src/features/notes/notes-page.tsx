/**
 * Renders the notes list from its shared API query options. The index route uses this page for
 * pending, failed, empty and populated results.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { notesQuery } from "../../api/notes";
import { useServices } from "../../app/services";
import { ErrorState } from "../../components/error-state";

export function NotesPage() {
  const { api } = useServices();
  const notes = useQuery(notesQuery(api));

  return (
    <section>
      <h1>Notes</h1>
      {notes.isPending && <p role="status">Loading notes…</p>}
      {notes.isError && <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />}
      {notes.isSuccess && notes.data.items.length === 0 && <p>No notes yet.</p>}
      {notes.isSuccess && notes.data.items.length > 0 && (
        <ul className="note-list">
          {notes.data.items.map((note) => (
            <li key={note.id}>
              <Link to={`/notes/${encodeURIComponent(note.id)}`}>{note.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
