import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/errors";
import { itemQuery } from "../../api/items";
import { useServices } from "../../app/services";
import { ErrorState } from "../../components/error-state";

export function ItemPage() {
  const { id = "" } = useParams();
  const { api } = useServices();
  const item = useQuery(itemQuery(api, id));
  const missing = item.error instanceof ApiError && item.error.status === 404;

  return (
    <section>
      <Link to="/">← All items</Link>
      {item.isPending && <p role="status">Loading item…</p>}
      {missing && <h1>Item not found</h1>}
      {item.isError && !missing && (
        <ErrorState error={item.error} onRetry={() => void item.refetch()} />
      )}
      {item.isSuccess && (
        <article>
          <h1>{item.data.name}</h1>
          <p>{item.data.description}</p>
        </article>
      )}
    </section>
  );
}
