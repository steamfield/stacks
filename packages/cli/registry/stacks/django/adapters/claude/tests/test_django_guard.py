import json
import os
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / ".claude/hooks/guard-django.sh"
GIT = ["git", "-c", "user.name=test", "-c", "user.email=test@example.com"]
GIT += ["-c", "commit.gpgsign=false"]


def git(root: Path, *args: str) -> None:
    subprocess.run([*GIT, "-C", str(root), *args], check=True, capture_output=True)


def ship_migrations(root: Path) -> None:
    for app in ("accounts", "notes"):
        migrations = root / app / "migrations"
        migrations.mkdir(parents=True)
        (migrations / "__init__.py").write_text("")
        (migrations / "0001_initial.py").write_text("# shipped\n")


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A project as stacks new leaves it: the shipped migrations exist and git has no commits."""
    ship_migrations(tmp_path)
    git(tmp_path, "init", "-q")
    return tmp_path


def generate(root: Path, name: str) -> str:
    """A migration makemigrations wrote, not yet committed."""
    (root / "notes" / "migrations" / name).write_text("# generated\n")
    return f"notes/migrations/{name}"


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
    "path",
    [
        "notes/migrations/0001_initial.py",
        "./notes/../notes/migrations/0001_initial.py",
        "accounts/migrations/0001_initial.py",
    ],
)
def test_shipped_migrations_cannot_change_before_the_first_commit(project: Path, path: str) -> None:
    assert "add a new migration" in denied(project, {"file_path": path})


def test_shipped_migrations_cannot_change_outside_git(tmp_path: Path) -> None:
    ship_migrations(tmp_path)
    reason = denied(tmp_path, {"file_path": "notes/migrations/0001_initial.py"})
    assert "shipped with the project" in reason


def test_committed_migrations_cannot_change(project: Path) -> None:
    path = generate(project, "0002_backfill.py")
    git(project, "add", ".")
    git(project, "commit", "-q", "-m", "init")
    assert "is committed" in denied(project, {"file_path": path})


def test_absolute_paths_are_recognized(project: Path) -> None:
    path = str(project / "notes/migrations/0001_initial.py")
    assert "makemigrations" in denied(project, {"file_path": path})


def test_new_migrations_come_from_makemigrations(project: Path) -> None:
    reason = denied(project, {"file_path": "notes/migrations/0003_by_hand.py"})
    assert "makemigrations --empty" in reason


@pytest.mark.parametrize("staged", [False, True])
def test_a_generated_migration_can_be_edited_until_committed(project: Path, staged: bool) -> None:
    path = generate(project, "0002_backfill.py")
    if staged:
        git(project, "add", ".")
    assert decide(project, {"file_path": path}) == ""
    assert decide(project, {"file_path": "notes/migrations/__init__.py"}) == ""


def test_lockfile_is_generated(project: Path) -> None:
    assert "uv add" in denied(project, {"file_path": "uv.lock"})


@pytest.mark.parametrize(
    "command",
    [
        "pip install requests",
        "python -m pip install httpx",
        "cd x && uv pip install a",
        "uv run pip install x",
        "uv run python -m pip install x",
        ".venv/bin/pip install x",
        "python3.13 -m pip install x",
        "pip3.13 install x",
        "pip --disable-pip-version-check install x",
        "sudo pip install x",
        "env PIP_NO_INPUT=1 pip install x",
        "bash -c 'pip install x'",
        '"pip" install x',
    ],
)
def test_pip_install_is_denied(project: Path, command: str) -> None:
    assert "uv add" in denied(project, {"command": command})


@pytest.mark.parametrize(
    "command",
    [
        "uv add django-htmx",
        "make makemigrations",
        "uv run pytest tests",
        "pip list",
        "uv pip list",
        "pipx install ruff",
        "echo pip install x",
        "git commit -m 'pip install fix'",
    ],
)
def test_other_commands_pass(project: Path, command: str) -> None:
    assert decide(project, {"command": command}) == ""


def test_other_edits_pass(project: Path) -> None:
    assert decide(project, {"file_path": "notes/models.py"}) == ""
