/**
 * Renders one note using the route parameter and shared detail query options. It distinguishes
 * a missing note from other request failures and links back to the list.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/errors";
import { noteQuery } from "../../api/notes";
import { useServices } from "../../app/services";
import { ErrorState } from "../../components/error-state";

export function NotePage() {
  const { id = "" } = useParams();
  const { api } = useServices();
  const note = useQuery(noteQuery(api, id));
  const missing = note.error instanceof ApiError && note.error.status === 404;

  return (
    <section>
      <Link to="/">← All notes</Link>
      {note.isPending && <p role="status">Loading note…</p>}
      {missing && <h1>Note not found</h1>}
      {note.isError && !missing && (
        <ErrorState error={note.error} onRetry={() => void note.refetch()} />
      )}
      {note.isSuccess && (
        <article>
          <h1>{note.data.title}</h1>
          <p>{note.data.body}</p>
        </article>
      )}
    </section>
  );
}
