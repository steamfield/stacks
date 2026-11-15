# Private text helpers

[words.ts](words.ts) splits normalized text into words and joins them within a length
limit. Start there to read the algorithms; [../slugify.ts](../slugify.ts) coordinates
them with validation and errors. The helpers depend only on language built-ins and are
tested through the public slug functions in `../slugify.test.ts`.

This folder is behind the library's public boundary. Public modules may import its
helpers, but `../index.ts` never re-exports them. Keep implementation details here when
callers should not depend on them.
