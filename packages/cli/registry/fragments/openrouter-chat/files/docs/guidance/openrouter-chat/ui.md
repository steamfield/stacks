# UI

- Components never import Effect or anything under `app/.server/`. Data comes from loaders, `useChat`, or a fetch to a resource route.
- `app/components/ui/` is shadcn output, owned by the project once added. Add components with the shadcn CLI rather than hand-writing them; edit them freely after.
- Styling, tokens, and motion: `styling.md` (the ladder, and which rules the Biome style plugin enforces) and `DESIGN.md` at the repo root (the system and its reasons).
- Chat UI states to cover: empty, streaming, tool call in progress, finished (with tokens and cost under the reply), interrupted, error (Retry only when the `ErrorBody` says `retryable`; read it with `errorFrom`), not configured (a notice, and the composer can't send). Each gets a component test.
- The model picker is a searchable combobox grouped by provider; the list can be hundreds of models.
- Accessible by default: real buttons and labels, focus visible, the composer submits on Enter and adds a newline on Shift+Enter.
