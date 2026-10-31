import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { itemsQuery } from "../../api/items";
import { useServices } from "../../app/services";
import { ErrorState } from "../../components/error-state";

export function ItemsPage() {
  const { api } = useServices();
  const items = useQuery(itemsQuery(api));

  return (
    <section>
      <h1>Items</h1>
      {items.isPending && <p role="status">Loading items…</p>}
      {items.isError && <ErrorState error={items.error} onRetry={() => void items.refetch()} />}
      {items.isSuccess && items.data.length === 0 && <p>No items yet.</p>}
      {items.isSuccess && items.data.length > 0 && (
        <ul className="item-list">
          {items.data.map((item) => (
            <li key={item.id}>
              <Link to={`/items/${encodeURIComponent(item.id)}`}>{item.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
