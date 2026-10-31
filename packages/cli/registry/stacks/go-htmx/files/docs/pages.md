# Pages, forms and htmx

## Routes

| Method and path | Plain request | htmx request (`HX-Request: true`) |
|---|---|---|
| `GET /` | The notes page (layout, form, list) | The same page |
| `POST /notes`, valid | 303 to `/` | 200: the new `<li>` (swapped into `#notes` with `afterbegin`) and an empty form marked `hx-swap-oob="true"` |
| `POST /notes`, invalid | 422: the whole page, form errors shown, values kept | 422: the form only, with `HX-Retarget: #note-form` and `HX-Reswap: outerHTML` |
| `GET /static/<file>` | Embedded asset, `Cache-Control: public, max-age=3600` | |
| `GET /healthz` | `ok`, plain text, `no-store` | |

Forms post `application/x-www-form-urlencoded` bodies up to 64 KiB; larger
bodies get 413 and unreadable ones 400.

## Status codes and swaps

htmx swaps 2xx and 3xx responses by default and ignores 4xx and 5xx. The layout's
`htmx-config` meta tag (`views.HTMXConfig`) adds a rule that swaps 422, so a
form comes back with its errors. Every other error status renders the error
page and htmx leaves the page as it was (it fires `htmx:responseError`).

htmx follows redirects inside the request and swaps the final page into the
target, so an htmx request never gets a 3xx. Send `HX-Redirect` with a 200 when
an htmx action should navigate.

## Error pages

| Code | Status | Title |
|---|---|---|
| Invalid | 422 | Check the form (forms render their own errors) |
| BadInput | 400 | Bad request |
| Forbidden | 403 | Request blocked (cross-origin post) |
| NotFound | 404 | Page not found |
| MethodNotAllowed | 405 | Method not allowed |
| PayloadTooLarge | 413 | Request too large |
| Internal | 500 | Something went wrong |
| Unavailable | 503 | Service unavailable |

Every page shows the request id, which is also the `X-Request-Id` header and the
`request_id` field in the logs.

## Security headers

Every response carries `Content-Security-Policy: default-src 'self';
frame-ancestors 'none'; form-action 'self'; base-uri 'none'`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. The policy
blocks inline scripts and styles, so the htmx config turns off `allowEval` (no
`hx-on` attributes) and htmx's injected indicator styles; `static/app.css`
styles `.htmx-request` instead.

Cross-site POSTs are rejected with 403 by `http.CrossOriginProtection`, which
reads `Sec-Fetch-Site` and `Origin`. Requests with neither header (curl, tests)
are allowed. Behind a proxy on another origin, add it with `AddTrustedOrigin`.
