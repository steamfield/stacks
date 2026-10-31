---
name: change-public-api
description: Add, rename or remove a public function, class or exception in this library, keeping __all__, docs/api.md, the public-API test and the CHANGELOG in step. Use when the user asks for a new function, a new exception, or any change to what users import.
---

# Change the public API

`parse_duration` and `ParseError` are the models. Read `src/<package>/__init__.py`, `docs/api.md` and `tests/test_public_api.py` first.

1. A removal, rename or signature change breaks users. Confirm it with the user before writing code, and note that it needs a major version bump (minor before 1.0).
2. Write the code in an underscore module under `src/<package>/` (a new one for a new area). Full type hints and a docstring with a `Raises:` section.
3. A new failure gets an exception class in `_errors.py` deriving from `Error` and the matching built-in, with any data callers need as attributes.
4. Import it in `__init__.py` and add it to `__all__`.
5. Add the name to `PUBLIC` in `tests/test_public_api.py` and a `###` section with a backticked name in `docs/api.md` (signature, behavior, what it raises). The test compares those headings with `__all__`.
6. Tests: examples and every error path in a `tests/test_<module>.py`, and a Hypothesis property in `tests/test_properties.py` when an invariant holds for all inputs.
7. Add a CHANGELOG line under `Unreleased` (`Added`, `Changed`, `Removed`).
8. Run `make lint typecheck coverage test-min smoke`.
