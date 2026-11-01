---
name: add-public-api
description: Add a public type, method, factory or error to this Java library with its Javadoc, example, tests, consumer call and API notes. Use when the user asks the library to expose something new, accept a new setting, or report a new kind of failure.
---

# Add to the public API

`SlugRules.withMaxLength` is the worked example: the factory and its check in `SlugRules`, the `rules` region in `ExamplesTest` its Javadoc shows, its cases in `SlugRulesTest` and `SlugPropertiesTest`, the call in the consumer's `Names`, and its row in `docs/public-api.md`.

1. **Decide.** Read `docs/public-api.md`. A new class, static method or factory is compatible; changing or removing a public name, or adding a record to the sealed `SlugError`, breaks callers. Tell the user before writing a breaking change and stop there unless they agree.
2. **Write.** Public types go in `app`, as `final` classes with static factories or records; helpers go in `app.internal` and never appear in a public signature. A setting is a new factory or method on the rules type, never a new parameter on an existing method.
3. **Fail.** Throw an unchecked exception that carries a record of the failure, as `SlugException` carries a `SlugError`. Validate arguments with `IllegalArgumentException` and a message naming the argument.
4. **Document.** Javadoc on the type and every public member, with `@param`, `@return` and `@throws`. Add a region to `src/test/java/app/ExamplesTest.java` (`// @start region="<name>"` ... `// @end`) that calls the new API and asserts the result, and point the Javadoc at it with `{@snippet file="app/ExamplesTest.java" region="<name>"}`.
5. **Test.** Unit cases beside the code for every path and each error record; a generated-input loop in `SlugPropertiesTest` (or a properties test beside the new type) for a parser or conversion; a call in `src/it/consumer/src/main/java/consumer/Names.java` with an assertion in `NamesTest`.
6. Add the row to `docs/public-api.md`, then run `make fmt compile coverage docs test-consumer api-check`. `make api-check` must pass: a compatible addition never fails it.
