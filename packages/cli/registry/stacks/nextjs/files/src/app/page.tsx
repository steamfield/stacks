import { AddItemForm } from "@/components/add-item-form";
import { config } from "@/lib/server/config";
import { listItems } from "@/lib/server/items";
import { addItemAction } from "./actions";
import styles from "./page.module.css";

// This process-local list must be read for each request, never frozen during the build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const items = await listItems();
  return (
    <>
      <h1>{config().APP_TITLE}</h1>
      <p>Items live in this server process and reset when it restarts.</p>
      <ul className={styles.items} aria-label="Items">
        {items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <AddItemForm action={addItemAction} />
    </>
  );
}
