import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AddNoteForm from "./AddNoteForm.vue";

// registerEndpoint stands in for the server route inside the test's Nuxt app. The real route
// and its validation run in e2e/notes.spec.ts against the built server.
describe("AddNoteForm", () => {
  it("shows the server's field error and keeps the typed value", async () => {
    registerEndpoint("/api/notes", {
      method: "POST",
      handler: () => {
        throw createError({
          statusCode: 400,
          data: { fields: { text: "Enter a note." } },
        });
      },
    });
    const form = await mountSuspended(AddNoteForm);
    await form.get("input").setValue("   ");
    await form.get("form").trigger("submit");
    await flushPromises();

    const alert = form.get('[role="alert"]');
    expect(alert.text()).toBe("Enter a note.");
    expect(form.get("input").attributes("aria-describedby")).toBe(alert.attributes("id"));
    expect((form.get("input").element as HTMLInputElement).value).toBe("   ");
    expect(form.emitted("added")).toBeUndefined();
    expect(form.get("button").attributes("disabled")).toBeUndefined();
  });

  it("clears the field and announces the write on success", async () => {
    registerEndpoint("/api/notes", {
      method: "POST",
      handler: () => ({ note: { id: "n1", text: "Saved", createdAt: "" } }),
    });
    const form = await mountSuspended(AddNoteForm);
    await form.get("input").setValue("Saved");
    await form.get("form").trigger("submit");
    await flushPromises();

    expect(form.emitted("added")).toHaveLength(1);
    expect((form.get("input").element as HTMLInputElement).value).toBe("");
    expect(form.find('[role="alert"]').exists()).toBe(false);
  });
});
