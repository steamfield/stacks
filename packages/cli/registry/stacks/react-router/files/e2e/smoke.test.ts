import { expect, test } from "@playwright/test";

test("built SSR page hydrates, submits a server action, and serves health", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const health = await request.get("/healthz");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  expect(health.headers()["x-request-id"]).toBeTruthy();
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-request-id"]).toBeTruthy();
  expect(await response?.text()).toContain("Hello, world!");
  await expect(page.getByRole("status")).toHaveText("Hello, world!");
  const documentId = await page.evaluate(() => {
    document.documentElement.dataset.proof = crypto.randomUUID();
    return document.documentElement.dataset.proof;
  });
  await page.getByLabel("Your name").fill("Ada");
  const [submitted] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && !response.request().isNavigationRequest(),
    ),
    page.getByRole("button", { name: "Greet" }).click(),
  ]);
  expect(submitted.status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("Hello, Ada!");
  expect(await page.evaluate(() => document.documentElement.dataset.proof)).toBe(documentId);
  expect(errors).toEqual([]);
});

test("built app renders its not-found boundary", async ({ page }) => {
  await page.goto("/missing");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Resource not found.");
  expect(await page.getByRole("button", { name: "Retry" }).count()).toBe(0);
});

test("an action error document preserves its request id and cache policy", async ({ request }) => {
  const response = await request.post("/?index", {
    headers: { "content-type": "application/json" },
    data: "broken",
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["x-request-id"]).toBeTruthy();
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.text()).toContain("Invalid request.");
});
