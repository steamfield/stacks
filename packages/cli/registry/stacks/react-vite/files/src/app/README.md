# App shell and routing

Start with [routes.tsx](routes.tsx), the route tree used by browser startup and
component tests. It mounts the items pages under [layout.tsx](layout.tsx) and
uses [route-error.tsx](route-error.tsx) for unmatched URLs and rendering failures.

[services.tsx](services.tsx) supplies the API client and logger through React
context. `../main.tsx` creates those services and the query cache;
`../../tests/render.tsx` supplies fresh instances with a memory router.

[routes.test.tsx](routes.test.tsx) follows navigation and request states through
the real pages with Testing Library and MSW.

