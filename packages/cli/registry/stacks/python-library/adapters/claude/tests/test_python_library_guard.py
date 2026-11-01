import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".claude/hooks/guard-python-library.sh"


def decide(tool_input: dict[str, str]) -> str:
    result = subprocess.run(
        ["/bin/bash", str(HOOK)],
        input=json.dumps({"tool_input": tool_input}),
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(ROOT)},
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def denied(tool_input: dict[str, str]) -> str:
    decision = json.loads(decide(tool_input))["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    return str(decision["permissionDecisionReason"])


@pytest.mark.parametrize(
    "command",
    [
        "pip install requests",
        "pip3 install -e .",
        "python -m pip install httpx",
        "uv pip install attrs",
        "cd src && pip install pytest",
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
def test_pip_install_is_denied(command: str) -> None:
    assert "uv add" in denied({"command": command})


@pytest.mark.parametrize(
    "command",
    [
        "uv add attrs",
        "make smoke",
        "uv run pytest tests/test_duration.py",
        "uv run twine check --strict dist/*",
        "pip list",
        "uv pip list",
        "pipx install ruff",
        "echo pip install x",
        "git commit -m 'pip install fix'",
    ],
)
def test_other_commands_pass(command: str) -> None:
    assert decide({"command": command}) == ""


@pytest.mark.parametrize(
    ("path", "fix"),
    [("uv.lock", "uv add"), ("./dist/x.whl", "make build"), (str(ROOT / "uv.lock"), "uv add")],
)
def test_generated_files_cannot_be_hand_edited(path: str, fix: str) -> None:
    assert fix in denied({"file_path": path})


@pytest.mark.parametrize(
    "path", ["pytest.ini", ".pytest.ini", "pytest.toml", "./.pytest.toml", str(ROOT / "pytest.ini")]
)
def test_a_pytest_config_file_that_overrides_pyproject_is_denied(path: str) -> None:
    assert "pyproject.toml" in denied({"file_path": path, "content": "[pytest]\n"})


def test_other_edits_remain_allowed() -> None:
    assert decide({"file_path": str(ROOT / "src" / "x.py"), "content": "pythonpath = 1\n"}) == ""
    assert decide({"file_path": "pyproject.toml", "new_string": 'version = "0.2"\n'}) == ""
    assert decide({"file_path": "tests/pytest.ini.md", "content": "notes\n"}) == ""
    assert decide({"file_path": "tox.ini", "content": "[tox]\n"}) == ""
