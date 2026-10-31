"""Database test session hooks: one run id per pytest run, its template dropped at the end."""

import os
import secrets

import pytest

from tests.db import harness


def pytest_configure(config: pytest.Config) -> None:
    # The controlling process sets the id before xdist starts workers, which inherit it.
    if not hasattr(config, "workerinput"):
        os.environ[harness.RUN_ENV] = secrets.token_hex(4)


def pytest_sessionfinish(session: pytest.Session) -> None:
    if not hasattr(session.config, "workerinput"):
        harness.drop_database(harness.template_name(harness.run_id()))
