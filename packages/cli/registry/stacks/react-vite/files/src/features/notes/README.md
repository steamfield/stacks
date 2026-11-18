# Notes pages

Start with [notes-page.tsx](notes-page.tsx), which reads the list query and renders
pending, error, empty or linked results. [note-page.tsx](note-page.tsx) reads the
route id and shows a detail result, distinguishing a missing note from other failures.

Both pages get their API client from `../../app/services.tsx` and use the
query options in `../../api/notes.ts`. They share `../../components/error-state.tsx`
for safe error messages, request ids and retry actions.

`../../app/routes.tsx` mounts the pages; its adjacent component tests cover
navigation and failed requests through MSW.
