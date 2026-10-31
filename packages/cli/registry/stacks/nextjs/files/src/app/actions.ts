"use server";

import { revalidatePath } from "next/cache";
import { type ItemState, parseItem } from "@/lib/item-schema";
import { addItem } from "@/lib/server/items";
import { logEvent } from "@/lib/server/logging";

export async function addItemAction(
  _previous: ItemState,
  form: FormData,
): Promise<ItemState> {
  const requestId = crypto.randomUUID();
  const parsed = parseItem(form);
  if (parsed.status === "invalid") {
    logEvent("item.rejected", requestId);
    return parsed.state;
  }
  await addItem(parsed.data.name);
  revalidatePath("/");
  logEvent("item.added", requestId);
  return { status: "success", values: { name: "" } };
}
