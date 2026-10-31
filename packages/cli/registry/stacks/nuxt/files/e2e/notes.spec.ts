import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

// Clicking before hydration submits a plain form instead of running the Vue handler.
async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForFunction(
    () =>
      (window as unknown as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp?.()
        .isHydrating === false,
  );
  return response;
}

const ErrorBody = z.object({
  statusCode: z.number(),
  statusMessage: z.string(),
  message: z.string(),
});

test("renders notes on the server, validates, writes and keeps the write after reload", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("Read the code");

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "/");
  await expect(page).toHaveTitle("Notes");
  const list = page.getByRole("list", { name: "Notes" });
  await expect(list.getByText("Run the checks", { exact: true })).toBeVisible();
  const before = await list.getByRole("listitem").count();

  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a note.");
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveAttribute("aria-invalid", "true");
  await expect(list.getByRole("listitem")).toHaveCount(before);

  const text = `Note ${crypto.randomUUID()}`;
  await page.getByRole("textbox", { name: "Note" }).fill(`  ${text}  `);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(list.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue("");

  await page.reload();
  await expect(list.getByText(text, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("health reports live state with a request id and no caching", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = z
    .object({ status: z.literal("ok"), notes: z.number().int().min(2) })
    .parse(await response.json());
  expect(body.status).toBe("ok");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-request-id"]).toMatch(/^[\w-]+$/);
});

test("the API rejects a bad note with field errors and writes nothing", async ({ request }) => {
  const before = z
    .object({ notes: z.array(z.unknown()) })
    .parse(await (await request.get("/api/notes")).json()).notes.length;
  const response = await request.post("/api/notes", { data: { text: "" } });
  expect(response.status()).toBe(400);
  const body = ErrorBody.extend({
    data: z.object({ fields: z.object({ text: z.string() }) }),
  }).parse(await response.json());
  expect(body.data.fields.text).toBe("Enter a note.");
  const after = z
    .object({ notes: z.array(z.unknown()) })
    .parse(await (await request.get("/api/notes")).json()).notes.length;
  expect(after).toBe(before);
});

test("an unknown API path is a JSON 404", async ({ request }) => {
  const response = await request.get("/api/missing");
  expect(response.status()).toBe(404);
  expect(ErrorBody.parse(await response.json()).statusCode).toBe(404);
});

test("an unknown page renders the error page with a 404", async ({ page }) => {
  const response = await open(page, "/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByText("We couldn't find this page.")).toBeVisible();
  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
});
