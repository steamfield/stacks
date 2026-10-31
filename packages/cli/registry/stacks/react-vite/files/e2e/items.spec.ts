import { expect, type Page, test } from "@playwright/test";
import { loadEnv } from "vite";
import { items } from "../tests/fixtures/items";

// The API base the build baked in, read the way `vite build` reads it, so the routes below catch
// the requests whatever VITE_API_URL is.
const configured = loadEnv("production", process.cwd(), "VITE_").VITE_API_URL || "/api";
const apiBase = configured.replace(/\/+$/, "");
const api = (path: string) =>
  apiBase.startsWith("/") ? `**${apiBase}${path}` : `${apiBase}${path}`;

/** Stands in for the external API: the browser's requests never leave the machine. */
async function fakeApi(page: Page) {
  await page.route(api("/items"), (route) => route.fulfill({ json: { items } }));
  await page.route(api("/items/*"), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const item = items.find((candidate) => candidate.id === id);
    return item
      ? route.fulfill({ json: item })
      : route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("lists items and opens one", async ({ page }) => {
  const errors = collectErrors(page);
  await fakeApi(page);
  await page.goto("/");
  await page.getByRole("link", { name: "First item" }).click();
  await expect(page).toHaveURL(/\/items\/1$/);
  await expect(page.getByRole("heading", { name: "First item" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a deep link survives a reload", async ({ page }) => {
  await fakeApi(page);
  const response = await page.goto("/items/2");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Second item" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Second item" })).toBeVisible();
});

test("an unknown address renders the not-found page", async ({ page }) => {
  await fakeApi(page);
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to items" }).click();
  await expect(page.getByRole("link", { name: "First item" })).toBeVisible();
});

test("an API failure shows the request id", async ({ page }) => {
  await page.route(api("/items"), (route) =>
    route.fulfill({ status: 500, headers: { "x-request-id": "req-e2e" }, json: {} }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("The server had a problem.");
  await expect(page.getByRole("alert")).toContainText("Request ID: req-e2e");
});
