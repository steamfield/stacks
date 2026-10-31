import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import ErrorPage from "./error.vue";

describe("error page", () => {
  it("shows the status and fixed text for a missing page", async () => {
    const page = await mountSuspended(ErrorPage, {
      props: { error: createError({ statusCode: 404 }) },
    });
    expect(page.get("h1").text()).toBe("404");
    expect(page.text()).toContain("We couldn't find this page.");
  });

  it("never renders an error's own message", async () => {
    const page = await mountSuspended(ErrorPage, {
      props: {
        error: createError({ statusCode: 500, message: "db password leaked" }),
      },
    });
    expect(page.get("h1").text()).toBe("500");
    expect(page.text()).toContain("Something went wrong.");
    expect(page.text()).not.toContain("db password");
  });
});
