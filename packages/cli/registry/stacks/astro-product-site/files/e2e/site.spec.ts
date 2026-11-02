import { readdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { site } from "../src/config";

// The first docs page on disk stands in for every docs page.
const firstDoc = readdirSync("src/content/docs", { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".md"))
  .sort()[0];
const DOC = `/docs/${firstDoc?.replace(/\.md$/, "")}/`;
const [firstInstall, secondInstall] = site.install;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

for (const path of ["/", DOC]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${path} in ${scheme} passes axe with no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("the theme choice persists from the landing page to the docs", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Dark theme" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.goto(DOC);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("install tabs switch commands once hydrated", async ({ page }) => {
  test.skip(!secondInstall, "only one install option");
  await page.goto("/");
  await page.getByRole("tab", { name: secondInstall?.label }).click();
  await expect(page.getByRole("tabpanel")).toContainText(secondInstall?.command ?? "");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the docs menu opens and the first install command shows", async ({ page, isMobile }) => {
    await page.goto(DOC);
    if (isMobile) {
      await page.getByText("Docs menu").click();
      await expect(page.getByRole("navigation", { name: "Docs menu" })).toBeVisible();
    } else {
      await expect(page.getByRole("navigation", { name: "Docs" })).toBeVisible();
    }
    await page.goto("/");
    await expect(page.getByRole("tabpanel")).toContainText(firstInstall?.command ?? "");
  });
});
