"""`make db-check`: fail when the models and the migrations disagree.

`alembic check` compares the models with a live database, so it runs on a throwaway database
on db-test that only the migrations built. Run against the dev database, a hand-run ALTER TABLE
would hide a missing migration.
"""

import secrets
import sys

from tests.db import harness


def main() -> int:
    template = harness.ensure_template(f"chk{secrets.token_hex(3)}")
    try:
        result = harness.alembic(harness.database_url(harness.admin_url(), template), "check")
    finally:
        harness.drop_database(template)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
