import { expect, test } from "@playwright/test";
import { z } from "zod";

test("server data, validation, action and revalidation survive a reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Items");
  const list = page.getByRole("list", { name: "Items" });
  await expect(list.getByText("Read the code", { exact: true })).toBeVisible();
  await expect(list.getByText("Run the checks", { exact: true })).toBeVisible();
  const before = await list.getByRole("listitem").count();
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter an item name." }),
  ).toHaveText("Enter an item name.");
  await expect(list.getByRole("listitem")).toHaveCount(before);
  const name = `Browser item ${crypto.randomUUID()}`;
  await page.getByRole("textbox", { name: "Item name" }).fill(`  ${name}  `);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("status")).toHaveText("Item added.");
  await expect(list.getByText(name, { exact: true })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(before + 1);
  await page.reload();
  await expect(list.getByText(name, { exact: true })).toBeVisible();
});

test("health reports live server state with a request id", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  const health = z
    .object({ status: z.literal("ok"), items: z.number().int().min(2) })
    .parse(body);
  expect(health.status).toBe("ok");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-request-id"]).toMatch(/^[\w-]+$/);
});

test("unknown paths use the not-found page and a 404 status", async ({
  page,
}) => {
  const response = await page.goto("/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to items" }).click();
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
});
