# Public API

What this crate exports, and the rules for changing it. Dependents compile against every item listed here, so a change to one is a release decision, not a refactor.

## Exports

Everything public is re-exported from the crate root in `src/lib.rs`; modules are private.

| Item | What it is |
| --- | --- |
| `Slug` | A validated identifier: `parse`, `as_str`, `FromStr`, `TryFrom<&str>`, `TryFrom<String>`, `Display`, `AsRef<str>`, `From<Slug> for String`, ordering and hashing |
| `Rules` | Validation settings: `Default`, `DEFAULT_MAX_LEN`, `with_max_len`, `max_len`, `parse` |
| `Error` | Every failure, `#[non_exhaustive]`: `Empty`, `TooLong`, `InvalidChar`, `MisplacedHyphen`, `ZeroMaxLen` |

## Features

| Feature | Adds | Default |
| --- | --- | --- |
| `serde` | `Serialize` and `Deserialize` for `Slug`, as a string validated on the way in | off |

Features only add: enabling one never removes an item or changes behavior callers without it see. `make check` and `make test` run with no features and with all of them.

## Semver

The crate follows Cargo's semver rules. Before 1.0 the minor version is the breaking one (0.1 to 0.2).

Breaking, so the next release bumps the breaking number:

- removing or renaming an exported item, method, variant or field, or changing a signature
- adding a variant to an enum that isn't `#[non_exhaustive]`, or a field to a struct whose fields are all public
- adding a required method to a public trait, or removing a trait impl (`Clone`, `Send`, `Serialize`)
- tightening what a function accepts (a valid input that now errors)
- removing a feature, or moving an item behind one

Not breaking: adding an item, a method, a trait impl, a variant to a `#[non_exhaustive]` enum, or a feature.

Defaults that keep changes cheap: public enums are `#[non_exhaustive]`; structs keep their fields private and expose constructors and accessors; new behavior goes behind a new function or a builder method rather than a new parameter.

## Checking a change

`make doc` shows the API as docs.rs will (`target/doc/<crate>/index.html`). After the first release, cargo-semver-checks compares the working tree against the published version and names each breaking change; until then, review the diff of `src/lib.rs` exports and every `pub` signature by hand.
