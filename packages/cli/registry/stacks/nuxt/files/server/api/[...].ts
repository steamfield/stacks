// Unknown /api paths answer a JSON 404 here instead of falling through to the page renderer.
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: "Not found" });
});
