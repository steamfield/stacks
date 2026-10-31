---
name: add-export
description: Add an exported function, type, method, option or error to this Go library with its doc comment, example, tests and API notes. Use when the user asks the package to expose something new, take a new option, or report a new kind of error.
---

# Add an exported name

`WithMax` is the worked example: the option and its validation in `New` (`duration.go`), the `ErrInvalidOption` sentinel in `errors.go`, its cases in `TestNew` and `tests/consumer`, `ExampleNew` in `example_test.go`, and its row in `docs/public-api.md`.

1. **Decide.** Read `docs/public-api.md`. Adding a name is compatible; changing or removing one breaks callers. Tell the user before writing a breaking change and stop there unless they agree.
2. **Write.** Put the code in the root package file it belongs to; helpers that aren't API go under `internal/`. A new setting is an `Option` validated in `New`, never a new parameter on an existing function.
3. **Fail.** A new kind of failure is an exported sentinel in `errors.go`, wrapped by the error the function returns (`%w`, or an `Unwrap` method), with any detail a caller needs in exported fields.
4. **Document.** A doc comment that starts with the name, says what it does and names the errors it returns. Add `Example<Name>` (or `Example<Type>_<Method>`) to `example_test.go` with an `// Output:` comment.
5. **Test.** Table cases beside the code for every path, including each error with `errors.Is` and `errors.As`; a fuzz property in `fuzz_test.go` for a new parser or encoder; a call in `tests/consumer/consumer_test.go`.
6. Add the row to `docs/public-api.md`, then run `make fmt lint test consumer api-check`. `make api-check` must pass: a compatible addition never fails it.
