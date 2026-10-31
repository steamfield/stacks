import { expect, test } from "@playwright/test";

test("browser window shows application info and a changing tick", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Application information" })).toBeVisible();
  await expect(page.getByText(/dev · browser/)).toBeVisible();
  await expect(page.getByLabel("Tick counter")).toHaveText(/^\d+$/);
  const first = await page.getByLabel("Tick counter").textContent();
  await expect(page.getByLabel("Tick counter")).not.toHaveText(first ?? "");
  await expect(page.getByRole("status", { name: "Connection" })).toHaveText("live");
});

test("a failed command is visible in the browser", async ({ page }) => {
  await page.goto("/?scenario=error&ticks=off");
  await expect(page.getByRole("alert")).toContainText("invalid_metadata");
  await expect(page.getByLabel("Tick counter")).toHaveText("not available");
});
