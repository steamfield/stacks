# Library source

Start with [index.ts](index.ts), the package's only public entry, which exports nothing
yet. [errors.ts](errors.ts) supplies the base error type and recognition helper for the
first API; [errors.test.ts](errors.test.ts) checks their contract. The error module stays
private until a public function needs it.

Add a feature module and its unit tests here, then export it by name from `index.ts`.
Keep source platform neutral, without runtime imports, process access or console output.
Update `../tests/public-api.test.ts`, the consumer fixtures and the package README in
the same change so the new API is documented and checked through every layer.
