# Browser app source

Start with [main.tsx](main.tsx), which validates public build-time configuration,
creates services and mounts the query cache and browser router.
[app/](app/README.md) owns the route tree, layout, error boundary and services context.

[api/](api/README.md) is the fetch and decoding boundary.
[features/items/](features/items/README.md) renders the example resource using
its query options. `components/error-state.tsx` shares the safe request-error
display across pages.

[config.ts](config.ts) owns Vite environment access;
[logging.ts](logging.ts) owns console records. Unit and component tests sit
beside modules, using the helpers and MSW server in `../tests/`.

