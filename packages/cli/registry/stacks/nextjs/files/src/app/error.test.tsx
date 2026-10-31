// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ErrorPage from "./error";

it("hides raw errors, logs only the digest and retries", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const error = Object.assign(new Error("private-database-password"), {
      digest: "safe-id",
    });
    let retries = 0;
    render(
      <ErrorPage
        error={error}
        reset={() => {
          retries++;
        }}
      />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Could not load this page.",
    );
    expect(
      screen.queryByText("private-database-password"),
    ).not.toBeInTheDocument();
    expect(output).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "render.failed", digest: "safe-id" }),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(retries).toBe(1);
  } finally {
    output.mockRestore();
  }
});
