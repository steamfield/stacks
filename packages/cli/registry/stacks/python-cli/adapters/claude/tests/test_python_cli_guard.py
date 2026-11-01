import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".claude/hooks/guard-python-cli.sh"


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


@pytest.mark.parametrize(
    "command",
    [
        "pip install requests",
        "pip3 install -e .",
        "python -m pip install httpx",
        "uv pip install rich",
        "cd src && pip install typer",
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
    decision = json.loads(decide({"command": command}))["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    assert "uv add" in decision["permissionDecisionReason"]


@pytest.mark.parametrize(
    "command",
    [
        "uv add requests",
        "make smoke",
        "uv run pytest tests/test_cli.py",
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
    decision = json.loads(decide({"file_path": path}))["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    assert fix in decision["permissionDecisionReason"]


def test_source_edits_remain_allowed() -> None:
    assert decide({"file_path": str(ROOT / "src" / "cli.py")}) == ""
