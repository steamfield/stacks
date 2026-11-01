# Public API

What this library exports, and the rules for changing it. Every caller compiles against the names below, so changing one is a release decision, not a refactor.

## Exports

`module-info.java` exports one package, `app`. `app.internal` is not exported: callers on the module path can't compile against it, and `make api-check` ignores it, so it can change in any release. On the classpath the module boundary doesn't apply, which is one more reason never to rely on the package name alone.

| Name | What it is |
| --- | --- |
| `Slug` | A validated slug: `parse`, `value`, `equals`, `hashCode`, `toString`, `compareTo` |
| `SlugRules` | The rules: `defaults`, `withMaxLength`, `maxLength`, `check` (an `Optional<SlugError>`), `parse`; `DEFAULT_MAX_LENGTH` |
| `SlugError` | Sealed interface with the records `Empty`, `TooLong(length, max)`, `InvalidChar(codePoint, index)`, `MisplacedHyphen(index)`, each with `message` |
| `SlugException` | The unchecked exception `parse` throws; `error()` returns the `SlugError` |

JSpecify's `@NullMarked` covers both packages: nothing in the API returns or accepts null.

## Compatibility

The library follows semantic versioning. While the major version is 0, a minor release may break callers, but treat a break as costly anyway.

Breaking, so the next release is a new major version (or, while the major is 0, the next minor):

- removing or renaming a public type, method, field or record component, or changing a signature
- adding an abstract method to a public interface, or a record to the sealed `SlugError` (an exhaustive `switch` over it stops compiling)
- making a class `final` that wasn't, or a checked exception where there was none
- rejecting input that used to parse, or parsing it to a different value
- exporting fewer packages, or a different module name

Compatible: a new class, a new static or default method, a new overload that doesn't make an existing call ambiguous, a new constant.

Defaults that keep changes cheap: classes are `final` with static factories (`Slug.parse`, `SlugRules.withMaxLength`) rather than public constructors; settings are new factories or methods on `SlugRules`, never new parameters on existing methods; failures carry their data in record components, so a caller never parses a message.

## Checking a change

`make api-check` compares the built jar with `api/baseline.jar`, the jar recorded at the last release, using japicmp, and fails on a binary- or source-incompatible change to the exported package. A compatible addition passes. The baseline moves only at a release (`docs/releasing.md`). `make docs` builds the Javadoc as Maven Central's `-javadoc.jar` will carry it.
