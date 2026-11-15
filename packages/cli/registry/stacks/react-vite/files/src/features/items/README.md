# Items pages

Start with [items-page.tsx](items-page.tsx), which reads the list query and renders
pending, error, empty or linked results. [item-page.tsx](item-page.tsx) reads the
route id and shows a detail result, distinguishing a missing item from other failures.

Both pages get their API client from `../../app/services.tsx` and use the
query options in `../../api/items.ts`. They share `../../components/error-state.tsx`
for safe error messages, request ids and retry actions.

`../../app/routes.tsx` mounts the pages; its adjacent component tests cover
navigation and failed requests through MSW.

