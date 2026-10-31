# Releasing

A release is a version number, a CHANGELOG section and the files in `dist/`.
Publishing to PyPI is permanent: a version number can never be uploaded twice,
even after the release is deleted, so a person runs the upload.

1. Move the `Unreleased` CHANGELOG entries under a new version heading. A
   removed or changed public name is a major bump (a minor one before 1.0).
2. Set `project.version` in `pyproject.toml` to that version, or run
   `uv version <version>` (`uv version --bump minor` and friends also work).
3. Run `make lint typecheck coverage test-min smoke`. `make smoke` rebuilds
   `dist/` and checks the wheel installs, imports and carries `py.typed`.
4. Commit, tag (`git tag v<version>`) and push the tag.
5. Upload `dist/*`. Trusted publishing from CI (PyPI's "trusted publisher"
   settings and the official publish action) avoids storing a token; from a
   workstation, `uv publish` reads a token from `UV_PUBLISH_TOKEN`. Try the
   release on TestPyPI first (`uv publish --publish-url https://test.pypi.org/legacy/`).
