// The test-only binding `vitest.workers.config.ts` adds from `readD1Migrations`.
// It exists only in the Workers test runtime; application code never reads it.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
