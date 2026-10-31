// Nuxt reads this file at dev, build, prepare and typecheck time. Runtime values come from
// runtimeConfig, which NUXT_* environment variables override when the built server starts.
export default defineNuxtConfig({
  modules: ["@nuxt/eslint"],
  css: ["~/assets/main.css"],
  devtools: { enabled: false },
  runtimeConfig: {
    // Private: only server code can read these (NUXT_LOG_LEVEL).
    logLevel: "info",
    public: {
      // Public: shipped to the browser (NUXT_PUBLIC_APP_TITLE). Never put a secret here.
      appTitle: "Notes",
    },
  },
});
