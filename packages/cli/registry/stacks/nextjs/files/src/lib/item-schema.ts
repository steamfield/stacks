import { z } from "zod";

export const itemSchema = z.object({
  name: z
    .string({ error: "Enter an item name." })
    .trim()
    .min(1, "Enter an item name.")
    .max(80, "Use at most 80 characters."),
});

export type ItemState =
  | { status: "idle" | "success"; values: { name: string } }
  | {
      status: "error";
      values: { name: string };
      error: { code: "INVALID_INPUT"; fields: { name: string } };
    };

export const initialItemState: ItemState = {
  status: "idle",
  values: { name: "" },
};

export function parseItem(form: FormData) {
  const name = form.get("name");
  const values = { name: typeof name === "string" ? name : "" };
  const result = itemSchema.safeParse({ name });
  if (result.success) return { status: "valid", data: result.data } as const;
  const state: ItemState = {
    status: "error",
    values,
    error: {
      code: "INVALID_INPUT",
      fields: {
        name: result.error.issues[0]?.message ?? "Enter an item name.",
      },
    },
  };
  return { status: "invalid", state } as const;
}
