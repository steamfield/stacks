import secrets

import pytest

from tests.db import harness


def fresh_run() -> str:
    return secrets.token_hex(4)


def test_one_runs_teardown_leaves_another_runs_databases() -> None:
    first, second = fresh_run(), fresh_run()
    first_db = harness.create_database(first, "a")
    second_db = harness.create_database(second, "b")
    try:
        harness.drop_database(first_db)
        harness.drop_database(harness.template_name(first))

        assert not harness.database_exists(first_db)
        assert not harness.database_exists(harness.template_name(first))
        assert harness.database_exists(second_db)
        assert harness.database_exists(harness.template_name(second))
    finally:
        for name in (first_db, second_db, harness.template_name(first)):
            harness.drop_database(name)
        harness.drop_database(harness.template_name(second))


def test_failed_migration_leaves_no_template() -> None:
    run = fresh_run()

    def broken(_url: str) -> None:
        raise RuntimeError("migration failed")

    with pytest.raises(RuntimeError, match="migration failed"):
        harness.ensure_template(run, migrate=broken)

    assert not harness.database_exists(harness.template_name(run))
