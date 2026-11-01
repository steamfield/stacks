# Pages, forms and htmx

How this app serves HTML. The notes pages follow every rule here.

## Pages

- A controller method returns a view name (`notes/index`), never HTML built in Java. Routes are plain paths (`/`, `/notes`, `/notes/{noteId}`), no `/v1` and no JSON.
- Every page replaces its `<html>` with `~{layout :: page(~{::title}, ~{::main})}` and supplies its own `<title>` and `<main>`. Shared markup goes in `layout.html`, not in a copied block.
- Text reaches the page through `th:text` (escaped). `th:utext` is for HTML the app itself wrote, never for user input.
- Links and form actions use `@{...}` so they carry the context path.
- Template comments are `<!--/* ... */-->`, which Thymeleaf strips; a plain `<!-- -->` ships to the browser.

## Forms

- Each form has a bean in its domain package (`NoteForm`) with Bean Validation constraints whose `message` is the sentence shown beside the field.
- The form tag has `th:action` and `method="post"`, so Thymeleaf adds the hidden `_csrf` field. A form without it is refused with 403.
- The handler takes `@Valid @ModelAttribute("<name>") <Form> form, BindingResult result`. With errors it re-renders the same view with status 200, the bound form keeping the user's input; each field shows `th:errors`.
- A plain post that succeeds redirects (POST, redirect, GET) with a flash attribute for the message, so a reload never posts twice.

## htmx

- htmx comes from its WebJar: `<script th:src="@{/webjars/htmx.org/dist/htmx.min.js}" defer>` in the layout. No CDN link, no copied file, no JavaScript build.
- A form that updates part of the page has both `th:action` (the fallback without JavaScript) and `th:hx-post` with the same address, plus `hx-target` and `hx-swap` on the form itself.
- The handler checks the `HX-Request` header. With it, the answer is the named fragment that replaces the target (`notes/index :: notes`); without it, the whole page or the redirect. Both paths render the same template, so they can't drift.
- Validation errors answer 200 with the fragment, so every htmx version swaps them in.

## Errors

| Status | Title | When |
|---|---|---|
| 400 | Bad request | The framework rejected the request (a missing or malformed parameter) |
| 403 | Forbidden | Spring Security refused it, usually a missing or stale CSRF token |
| 404 | Page not found | No route, no static file, or a note id the store doesn't have |
| 405 | Method not allowed | The route exists but not for this method; `Allow` lists the methods |
| 500 | Something went wrong | An unexpected exception; its class and stack frames are logged |
| 503 | Unavailable | A dependency is down |

Each row is an `ErrorCode`; `templates/error.html` shows its title and fixed
message, never the exception's text. A new failure is a new row and a row here.

## Security

`SecurityConfig` keeps Spring Security's defaults: CSRF tokens on every unsafe
method, `X-Content-Type-Options`, `X-Frame-Options: DENY` and
`Cache-Control: no-cache, no-store` on every response, static files included. Every page is public and there
are no users. Sign-in is added there (`formLogin`, a user store, an
`authorizeHttpRequests` rule per path), never by turning CSRF off.
