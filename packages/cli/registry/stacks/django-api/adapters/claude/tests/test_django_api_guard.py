import json
import os
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / ".claude/hooks/guard-django-api.sh"


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A git repository with one committed migration and one made but not yet committed."""
    migrations = tmp_path / "notes" / "migrations"
    migrations.mkdir(parents=True)
    (migrations / "__init__.py").write_text("")
    (migrations / "0001_initial.py").write_text("# committed\n")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "add", "."], check=True)
    (migrations / "0002_backfill.py").write_text("# new\n")
    return tmp_path


def decide(root: Path, tool_input: dict[str, str]) -> str:
    result = subprocess.run(
        ["/bin/bash", str(HOOK)],
        input=json.dumps({"tool_input": tool_input}),
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(root)},
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def denied(root: Path, tool_input: dict[str, str]) -> str:
    decision = json.loads(decide(root, tool_input))["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    return str(decision["permissionDecisionReason"])


@pytest.mark.parametrize(
    "path", ["notes/migrations/0001_initial.py", "./notes/../notes/migrations/0001_initial.py"]
)
def test_committed_migrations_cannot_change(project: Path, path: str) -> None:
    assert "add a new migration" in denied(project, {"file_path": path})


def test_absolute_paths_are_recognized(project: Path) -> None:
    path = str(project / "notes/migrations/0001_initial.py")
    assert "makemigrations" in denied(project, {"file_path": path})


def test_new_migrations_come_from_makemigrations(project: Path) -> None:
    reason = denied(project, {"file_path": "notes/migrations/0003_by_hand.py"})
    assert "makemigrations --empty" in reason


def test_an_uncommitted_generated_migration_can_be_edited(project: Path) -> None:
    assert decide(project, {"file_path": "notes/migrations/0002_backfill.py"}) == ""
    assert decide(project, {"file_path": "notes/migrations/__init__.py"}) == ""


def test_lockfile_is_generated(project: Path) -> None:
    assert "uv add" in denied(project, {"file_path": "uv.lock"})


@pytest.mark.parametrize("path", ["openapi.json", "./openapi.json"])
def test_openapi_schema_is_generated(project: Path, path: str) -> None:
    assert "make openapi" in denied(project, {"file_path": path})
    assert "make openapi" in denied(project, {"file_path": str(project / "openapi.json")})


@pytest.mark.parametrize(
    "command", ["pip install requests", "python -m pip install httpx", "cd x && uv pip install a"]
)
def test_pip_install_is_denied(project: Path, command: str) -> None:
    assert "uv add" in denied(project, {"command": command})


@pytest.mark.parametrize(
    "command", ["uv add django-filter", "make openapi", "uv run pytest tests", "pip list"]
)
def test_other_commands_pass(project: Path, command: str) -> None:
    assert decide(project, {"command": command}) == ""


def test_other_edits_pass(project: Path) -> None:
    assert decide(project, {"file_path": "notes/models.py"}) == ""
    assert decide(project, {"file_path": "docs/openapi.json.md"}) == ""
