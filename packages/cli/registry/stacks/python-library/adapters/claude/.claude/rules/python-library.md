---
paths:
  - "src/**"
  - "tests/**"
  - "docs/api.md"
  - "pyproject.toml"
---

# Library conventions

- The public API is `__all__` in `src/<package>/__init__.py`, documented in `docs/api.md` and pinned by `tests/test_public_api.py`. Adding, renaming or removing a public name changes all three and adds a CHANGELOG entry under `Unreleased`; a removal or signature change is a breaking change, so ask first.
- Implementation lives in underscore modules and is re-exported from `__init__.py`. Users import only from the package root.
- Every exception the library raises derives from `Error` in `_errors.py`, and also from the built-in a caller would expect (`ValueError`, `LookupError`). Never raise a bare built-in from public code.
- No runtime dependency without asking the user: every one is forced on every project that installs the library. When one is agreed, `uv add` it with a lower bound only and run `make test-min`.
- No `print`, no `logging.basicConfig`, no handlers. Log with `logging.getLogger(__name__)`; the application configures logging.
- Every public function and class has a docstring and full type hints; `py.typed` ships them to users.
- Keep code working on the oldest Python in `requires-python`: `make test-min` runs the tests there.
- Each public behavior gets example tests and, where an invariant holds for all inputs (round trips, ordering), a Hypothesis property in `tests/test_properties.py`.
- Never add `pythonpath` to pytest's config: tests import the installed package so packaging bugs show up.

See the project's `AGENTS.md` for commands and the remaining conventions.
