"use client";

import { useActionState } from "react";
import { initialItemState, type ItemState } from "@/lib/item-schema";

export function AddItemForm({
  action,
}: {
  action: (previous: ItemState, form: FormData) => Promise<ItemState>;
}) {
  const [state, submit, pending] = useActionState(action, initialItemState);
  const error = state.status === "error" ? state.error.fields.name : undefined;
  return (
    <form action={submit} noValidate>
      <label htmlFor="name">Item name</label>
      <input
        id="name"
        name="name"
        defaultValue={state.values.name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "name-error" : undefined}
      />
      {error && (
        <p id="name-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={pending}>{pending ? "Adding…" : "Add item"}</button>
      {state.status === "success" && <p role="status">Item added.</p>}
    </form>
  );
}
