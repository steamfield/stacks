# Development

`app/root.tsx` is the layout and safe error boundary. New routes go in `app/routes/`
and are registered in `app/routes.ts`. Keep server services in `app/.server/`;
the greeting service shows validation at the binding boundary. A loader returns only
the public values the page needs, never the environment object.

`workers/app.ts` passes bindings and the execution context into React Router and
logs fixed request fields as JSON. `app/entry.server.tsx` renders with web streams
and logs error classes without exception messages, request URLs or binding values.
Workers never write log files or start a Node HTTP server.

Public configuration lives in Wrangler vars. Add local secrets to ignored `.dev.vars`;
`.env.example` explains the boundary and is not loaded as Worker configuration.
`GREETING` defaults when absent and rejects blank or oversized values with status 503.
After changing bindings, regenerate `worker-configuration.d.ts` with the typecheck script.
Do not hand-edit generated bindings or `.react-router/types`.

`bun run test` builds the app, runs adjacent unit tests in the Workers runtime through
`@cloudflare/vitest-plugin`, and runs `tests/http.test.ts` on Node. The HTTP tests
start the built Worker with local Wrangler, exercise SSR, JSON, CSS, errors and the
scheduled export, and clean up their servers and temporary persistence directories.
`tests/ssr.test.ts` renders a failing route through the real request handler and
checks that initial rendering errors produce one safe log record.
No account, token or cloud resources are required. Framework virtual modules stay
out of the unit pool: `workers/scheduled.ts` is its separate entry.

`bun run coverage` uses Istanbul for the binding service and scheduled work, with
the configured floors. Framework behavior is covered over real HTTP rather than
instrumenting the built framework bundle. New services get adjacent Workers tests;
new routes also get HTTP cases. Do not replace request tests with static Worker stubs.
Vitest and Wrangler run on Node; Bun only installs and invokes scripts.

`workers/scheduled.ts` validates the binding and scheduled time, then logs a completion
record. It performs no product work. Keep failures observable; do not catch and discard
rejections. Add a production cron trigger only after choosing the job and its schedule.

Cloudflare's current guides:

- https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
- https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
