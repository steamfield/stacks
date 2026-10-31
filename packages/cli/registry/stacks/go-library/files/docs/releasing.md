# Releasing

A Go module is released by pushing a git tag; there is no registry upload. Once the module proxy has fetched a version it serves it forever, so a tag can be retracted but never replaced. A person tags and pushes; agents prepare the release and stop.

## Before the first release

- The module path in `go.mod` is where the code lives (`github.com/<owner>/<repo>`), and every import in the code and tests uses it.
- The README says what the module does and shows the shortest real use; pkg.go.dev shows it on the module page.
- A `LICENSE` file is at the root. pkg.go.dev hides the documentation of a module whose license it can't detect.

## Each release

1. Run `make ci`.
2. Decide the version from [the compatibility rules](public-api.md#compatibility). `make api-check` passing means nothing exported broke since the baseline; a compatible addition is the next minor, a fix the next patch.
3. Note the change for users in the release notes or a `CHANGELOG.md`.
4. The person tags the commit `v<version>` and pushes the tag. pkg.go.dev picks the version up after someone fetches it, or after a request on its page.
5. Record the new API as the baseline: `make api-baseline`, then commit `api/baseline.export`.

## A breaking release

From v1 on, a breaking change needs a new major version path: change the module line in `go.mod` to end in `/v2`, update every import of the module's own packages, then release the first v2 version. Before v1, the user may agree to break in a minor release. Either way, `make api-check` fails on the change until the person who agreed to it runs `make api-baseline` and commits the result.

## Withdrawing a version

Add a `retract` directive to `go.mod` naming the bad version with a comment saying why, and release a new version that carries it.
