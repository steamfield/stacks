import { expect, type Page, test } from "@playwright/test";
import { loadEnv } from "vite";
import { notes } from "../tests/fixtures/notes";

// The API base the build baked in, read the way `vite build` reads it, so the routes below catch
// the requests whatever VITE_API_URL is.
const configured = loadEnv("production", process.cwd(), "VITE_").VITE_API_URL || "/api";
const apiBase = configured.replace(/\/+$/, "");
const api = (path: string) =>
  apiBase.startsWith("/") ? `**${apiBase}${path}` : `${apiBase}${path}`;

/** Stands in for the external API: the browser's requests never leave the machine. */
async function fakeApi(page: Page) {
  await page.route(api("/v1/notes"), (route) =>
    route.fulfill({ json: { items: notes, nextCursor: null } }),
  );
  await page.route(api("/v1/notes/*"), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const note = notes.find((candidate) => candidate.id === id);
    return note
      ? route.fulfill({ json: note })
      : route.fulfill({ status: 404, json: { message: "Not found" } });
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("lists notes and opens one", async ({ page }) => {
  const errors = collectErrors(page);
  await fakeApi(page);
  await page.goto("/");
  await page.getByRole("link", { name: "First note" }).click();
  await expect(page).toHaveURL(/\/notes\/1$/);
  await expect(page.getByRole("heading", { name: "First note" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a deep link survives a reload", async ({ page }) => {
  await fakeApi(page);
  const response = await page.goto("/notes/2");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Second note" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Second note" })).toBeVisible();
});

test("an unknown address renders the not-found page", async ({ page }) => {
  await fakeApi(page);
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to notes" }).click();
  await expect(page.getByRole("link", { name: "First note" })).toBeVisible();
});

test("an API failure shows the request id", async ({ page }) => {
  await page.route(api("/v1/notes"), (route) =>
    route.fulfill({ status: 500, headers: { "x-request-id": "req-e2e" }, json: {} }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("The server had a problem.");
  await expect(page.getByRole("alert")).toContainText("Request ID: req-e2e");
});
