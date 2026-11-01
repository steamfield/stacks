---
schema_version: 1
id: python-library
kind: stack
name: Python library for PyPI
description: A typed Python library for PyPI in a src layout, built with uv and make. A py.typed marker, strict mypy, pytest with Hypothesis property tests on the newest and oldest supported Python, and a wheel and sdist checked with twine and installed in a clean environment.
tags: [python, library, make]
deps:
  dev: [ruff, mypy, pytest, pytest-cov, pytest-randomly, pytest-xdist, hypothesis, twine]
tools: [uv, make, git]
merge: [.claude/settings.json]
decisions:
  - "Supported Pythons: every CPython release that hasn't reached end of life, through the newest stable (default). Setup writes the oldest as requires-python's lower bound and pins the newest for development."
  - "Distribution name: the project slug (default). The import package is the slug with hyphens as underscores, which uv_build expects under src/."
  - "Build backend: uv_build, as `uv init --lib` writes it (default), or hatchling when the user needs build hooks or versions from git tags (hatch-vcs); then keep make build and make smoke passing."
  - "Versioning: a static version in pyproject.toml, changed with `uv version` (default), or git tags through hatch-vcs, which needs hatchling."
  - "License: MIT with the author and year (default). For another license, replace LICENSE and set project.license to its SPDX identifier."
  - "Coverage floor: 90% branch coverage (default)."
  - "Publishing: build and check locally; the user uploads (default). A release workflow with PyPI trusted publishing is deferred unless asked."
env: {}
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - { name: test-min, layer: test, run: make test-min }
  - { name: build, layer: build, run: make build }
  - { name: smoke, layer: test, run: make smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then git hooks outside CI
  lint: ruff check + ruff format --check
  format: ruff format + ruff check --fix
  typecheck: mypy strict over src, tests and scripts
  test: pytest (parallel) on the development Python
  coverage: pytest with the branch coverage floor
  test-min: pytest on the oldest supported Python, in a fresh environment
  build: Build the sdist and wheel into dist/ and check their metadata with twine
  smoke: Install the wheel on the oldest Python outside the source tree, import it, and type-check a consumer against it
  clean: Remove caches, build and coverage output
---

# Python library for PyPI

## What stacks wrote

A packaged, typed library that passes every check once its dev tools are installed. `src/package_name/` holds `__init__.py` (the public API: `__all__`, `__version__` from the installed metadata, and a `NullHandler` on the package logger), `_errors.py` (`Error`, the base every raised exception derives from, and `ParseError` and `RangeError`, which are also `ValueError`s), `_duration.py` (the payload: `parse_duration` and `format_duration` turn `1h30m` into a `timedelta` and back) and `py.typed`. `tests/` has example tests, Hypothesis properties (the round trip, and that any text either parses or raises a library error) and `test_public_api.py`, which fails when `__all__`, `docs/api.md` and the code disagree. `scripts/smoke.py` checks the installed wheel. `pyproject.toml` carries the metadata and tool config; the Makefile, `LICENSE`, `CHANGELOG.md`, `docs/api.md` and `docs/releasing.md` ship too. Read the code before extending it.

## Setup

No generator for the code. `pyproject.toml` ships without `[build-system]` and `requires-python`, because each carries a version.

1. Rename `src/package_name` to `src/<module>`, where `<module>` is the project slug with `-` replaced by `_`. Replace `package_name` with `<module>` in every file `grep -rl package_name src tests pyproject.toml README.md` lists.
2. Pick the supported range from python.org's release status page. Run `uv python pin <newest>` for development. Run `uv init --lib --name <slug> --vcs none` into an empty directory outside the project, copy only its `[build-system]` table into `pyproject.toml`, and set `project.requires-python = ">=<oldest>"` yourself (uv writes the interpreter it found, not the oldest supported), with no upper bound. Delete the scratch directory. Add a `Programming Language :: Python :: 3.<minor>` classifier for each supported version.
3. `uv add --dev` every dev dependency, so they resolve to current releases. The library has no runtime dependencies; keep `dependencies = []`.
4. `make install lint typecheck coverage test-min build smoke`. `test-min` and `smoke` download the oldest Python on first use. Update shipped code or config that the installed releases reject, keeping every ruff rule, strict mypy, `filterwarnings = ["error"]`, the coverage floor, `test-min` and the smoke step.
5. Record the supported Python range, uv and the build backend in AGENTS.md. Fill the README's `stacks:fill` markers (the docs link must be absolute, since PyPI renders the README away from the repository), then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- The public API is `__all__`, documented in `docs/api.md` and pinned by `tests/test_public_api.py`. A public name changes in all three at once, with a CHANGELOG line; removing or changing one is a breaking change.
- Implementation lives in underscore modules re-exported from `__init__.py`. Callers import from the package root only.
- Every exception the library raises derives from `Error` and from the built-in a caller would already catch. Exceptions carry the data a caller needs as attributes (`ParseError.position`), not only in the message.
- Library code never prints, configures logging or reads the environment. It logs through `logging.getLogger(__name__)` and takes settings as arguments with defaults.
- A runtime dependency needs the user's agreement and gets a lower bound only, never an upper bound or a pin. Dev tools go in the dev group with `uv add --dev`; commit `uv.lock` for development, but it doesn't constrain users.
- Code runs on the oldest Python in `requires-python`; `make test-min` proves it.
- Full type hints and a docstring on every public name; `py.typed` publishes the hints.

## Testing

Example tests go in one `tests/test_<module>.py` per module, covering each error path with its attributes. Invariants that hold for every input (round trips, ordering, idempotence) get a Hypothesis property in `tests/test_properties.py`. `test_public_api.py` changes only when the API does. Tests import the installed package (the src layout plus `--import-mode=importlib`), never the working tree. `make coverage` enforces the floor with branch coverage, random order and xdist; `make test-min` runs the same tests in a fresh environment on the oldest supported Python. `make smoke` installs the built wheel outside the source tree, imports it, checks `py.typed` and every `__all__` name, and runs strict mypy on a file that imports the package; it is the only check that the wheel is complete, so keep it.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them in AGENTS.md with a single-test command (`uv run pytest tests/test_duration.py`). `docs/releasing.md` covers versioning and publishing; uploads are the user's to run.

<!-- stacks:when with=git-hooks -->
Write lefthook.yml before `make install`: the recipe calls lefthook only outside CI when its config and executable exist. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python from .python-version), then `make install lint typecheck coverage test-min build smoke` with CI set. `test-min` covers the oldest Python, so a version matrix is optional; if the user wants one, run `make test` per version and keep `test-min`.
<!-- stacks:end -->

## Gotchas

- `make build` fails until Setup adds `[build-system]`; that is deliberate, not a broken file.
- Don't add `pythonpath = ["src"]` to pytest's config to fix an import error: run `make install`. Importing the working tree hides a module or `py.typed` missing from the wheel.
- `uv run --isolated` in `test-min` builds a fresh environment each run, so it is slower than `make test`. It reads the lockfile, which uv resolves for every Python in `requires-python`.
- mypy checks against the development Python, so it allows a newer stdlib API than the oldest supported release has. `test-min` catches it at runtime; read its failures that way.
- `twine check --strict` fails on README markup PyPI can't render; fix the README, don't drop `--strict`.
- `__version__` reads installed metadata, so a renamed distribution needs `make install` before tests pass.
- Hypothesis keeps failing examples in `.hypothesis/` (gitignored) and replays them first; a property that failed once fails again until fixed.
- Never set an upper bound on `requires-python` or a runtime dependency; it blocks users on newer releases.
