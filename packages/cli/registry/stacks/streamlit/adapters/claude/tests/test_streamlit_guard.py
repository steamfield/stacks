import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".claude/hooks/guard-streamlit.sh"


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


def denial(tool_input: dict[str, str]) -> str:
    decision = json.loads(decide(tool_input))["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    return str(decision["permissionDecisionReason"])


@pytest.mark.parametrize(
    "command",
    ["pip install streamlit", "python -m pip install polars", "uv pip install altair"],
)
def test_pip_install_is_denied(command: str) -> None:
    assert "uv add" in denial({"command": command})


@pytest.mark.parametrize(
    "command",
    [
        "streamlit run app.py",
        "uv run streamlit run app.py --server.port 8600",
        "make dev",
        "cd . && make start",
        "uv run streamlit hello",
    ],
)
def test_foreground_servers_are_denied(command: str) -> None:
    assert "AppTest" in denial({"command": command})


@pytest.mark.parametrize(
    "command",
    [
        "uv add streamlit",
        "make test",
        "make lint typecheck coverage",
        "uv run pytest tests/test_app.py",
        "uv run streamlit config show",
        "stacks verify",
    ],
)
def test_other_commands_pass(command: str) -> None:
    assert decide({"command": command}) == ""


@pytest.mark.parametrize(
    ("path", "fix"),
    [
        ("uv.lock", "uv add"),
        (str(ROOT / ".streamlit" / "secrets.toml"), "environment"),
        ("./.streamlit/secrets.toml", "environment"),
    ],
)
def test_generated_and_secret_files_cannot_be_written(path: str, fix: str) -> None:
    assert fix in denial({"file_path": path})


@pytest.mark.parametrize("path", ["app.py", ".streamlit/config.toml", "data/sample.csv"])
def test_source_config_and_data_remain_editable(path: str) -> None:
    assert decide({"file_path": str(ROOT / path)}) == ""
