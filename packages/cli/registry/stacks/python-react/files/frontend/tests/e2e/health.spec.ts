import { expect, test } from "@playwright/test";

test("reads the real API through Vite and refreshes it", async ({ page }) => {
  await page.route("**/*posthog*", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "API health" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("API status: ok");
  const response = page.waitForResponse(
    (response) => response.url().endsWith("/health") && response.ok(),
  );
  await page.getByRole("button", { name: "Check again" }).click();
  expect((await response).status()).toBe(200);
});

test("renders the route error page", async ({ page }) => {
  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return home" }).click();
  await expect(page.getByRole("status")).toHaveText("API status: ok");
});
