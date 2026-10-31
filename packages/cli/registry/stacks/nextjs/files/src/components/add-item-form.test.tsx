// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { type ItemState, parseItem } from "@/lib/item-schema";
import { AddItemForm } from "./add-item-form";

it("shows the parser's field error and preserves the submitted value", async () => {
  const user = userEvent.setup();
  render(
    <AddItemForm
      action={async (_previous, form) => {
        const parsed = parseItem(form);
        if (parsed.status === "invalid") return parsed.state;
        return { status: "success", values: { name: "" } };
      }}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Item name" });
  await user.type(input, "x".repeat(81));
  await user.click(screen.getByRole("button", { name: "Add item" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Use at most 80 characters.",
  );
  expect(input).toHaveValue("x".repeat(81));
  expect(input).toHaveAttribute("aria-invalid", "true");
});

it("disables submit while the action is pending and announces success", async () => {
  const user = userEvent.setup();
  let finish: (state: ItemState) => void = () => {
    throw new Error("Action not started");
  };
  const pending = new Promise<ItemState>((resolve) => {
    finish = resolve;
  });
  render(<AddItemForm action={() => pending} />);
  await user.type(
    screen.getByRole("textbox", { name: "Item name" }),
    "New item",
  );
  await user.click(screen.getByRole("button", { name: "Add item" }));
  expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
  await act(async () => {
    finish({ status: "success", values: { name: "" } });
    await pending;
  });
  expect(await screen.findByRole("status")).toHaveTextContent("Item added.");
  expect(screen.getByRole("button", { name: "Add item" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Item name" })).toHaveValue("");
});
