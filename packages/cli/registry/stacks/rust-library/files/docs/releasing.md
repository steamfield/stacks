# Releasing

Publishing to crates.io is permanent: a version can be yanked but never deleted or replaced. A person publishes; agents prepare the release and stop.

## Before the first release

- `Cargo.toml` has `version`, `description`, `license`, `repository` (or `homepage`), and up to five `keywords` and `categories` (crates.io lists the valid categories). `make package` refuses a `stacks:fill` placeholder, and `cargo package` warns about the rest.
- The license texts named by `license` sit at the root as `LICENSE-*` files, which `include` already packages.
- The README's first lines say what the crate does; it is the crates.io page and the docs.rs front page.
- The crate name is free on crates.io (`cargo search <name>`).

## Each release

1. Decide the version from [the semver rules](public-api.md#semver) and set `package.version`.
2. Note the change for users (a `CHANGELOG.md` entry or the release notes).
3. Run `make ci`. `make package` lists the files that would ship and compiles them from the extracted `.crate` in `target/package/`.
4. The person runs `cargo publish --dry-run`, then `cargo publish` with their crates.io token, and tags the commit `v<version>`.

Release tooling (release-plz, cargo-release) and semver checks in CI are deferred until the first release.
