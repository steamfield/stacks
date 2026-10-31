# Effect Schema

One schema owns each boundary shape and its TypeScript type. Decode incoming data and encode outgoing data through it. `tests/schema-conventions.test.ts` shows the patterns below as running checks; copy it for new boundary schemas.

## Conventions

- Schema is part of `effect`; never install the standalone `@effect/schema` package from older examples.
- Share the schema/type name: `export const User = Schema.Struct({...})`, `export type User = typeof User.Type`. Wire types use `typeof User.Encoded`.
- Use `Schema.Class` for entities with identity/behavior; `Schema.Struct` for DTOs and request/response bodies. Brand ids (`Schema.brand`) so domains cannot be swapped.
- Decode requests, env/config, storage rows, third-party responses, and structured LLM output at their boundaries. Inside, use decoded types without re-validation. Encode for storage/wire output.
- Checks (`.check(Schema.makeFilter(...))` or built-in checks such as `Schema.isGreaterThan`) validate; transformations change representation, such as date strings into `DateTime`. Never hide conversions in checks.
- Annotate exported schemas with titles, descriptions, and examples. `Schema.toJsonSchemaDocument` supplies JSON Schema to tools/structured-output libraries; decode their results with the same schema.
- For validation-only libraries accepting Standard Schema, use `Schema.toStandardSchemaV1`. Domain errors are typed, serializable `Schema.TaggedError` classes.
- Keep framework/codegen validators where a library requires them; use zod only at such a library edge. Transitive peer dependencies are fine.

## Testing

Test transformation round trips: `encode(decode(x))` equals valid input, plus a property over `Arbitrary.schema(S)` (or `@effect/vitest`'s `it.prop`) for non-trivial schemas. Check readable failures for meaningful missing fields, wrong brands, and out-of-range values, not every field.

## Gotchas

- Check installed types and docs for current checks, constructors, annotations, adapters, and JSON Schema APIs.
- Close external objects with `Schema.toJsonSchemaDocument(S, { onExcessProperty: "error" })`. That closes the document only: decoding still ignores excess keys unless the decoder gets the same option.
- Custom filters need `toJsonSchema` annotations, merged into the base schema. Annotations added after a check can be lost; confirm placement against installed types.
- An `identifier` annotation becomes a `$ref` into `definitions`, which LLM structured-output providers and simple validators resolve unreliably. Leave it off schemas they read.
