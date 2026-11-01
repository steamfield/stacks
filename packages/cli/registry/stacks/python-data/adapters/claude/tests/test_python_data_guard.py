import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".claude/hooks/guard-python-data.sh"


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
    [
        "pip install polars",
        "python -m pip install duckdb",
        "uv pip install altair",
        "cd x && pip3 install .",
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
    assert "uv add" in denial({"command": command})


@pytest.mark.parametrize(
    "command",
    [
        "marimo edit notebooks/explore.py",
        "uv run marimo run notebooks/explore.py",
        "make x; marimo new",
        "uvx marimo edit nb.py",
        "python -m marimo edit",
        "uv run python -m marimo edit nb.py",
        "uv run --with x marimo edit",
        "marimo -q edit nb.py",
        "timeout 5 marimo run nb.py",
        "uv run marimo tutorial intro",
    ],
)
def test_marimo_servers_are_denied(command: str) -> None:
    assert "make notebooks" in denial({"command": command})


@pytest.mark.parametrize(
    "command",
    [
        "uv add polars",
        "make notebooks",
        "uv run marimo check notebooks",
        "uv run marimo export html notebooks/explore.py -o /tmp/x.html",
        "cp /tmp/export/orders.csv data/raw/",
        "uv run marimo export html-wasm notebooks/explore.py -o out",
        "uv run python notebooks/explore.py",
        "echo marimo edit",
        "uv pip list",
        "pipx install ruff",
        "echo pip install x",
    ],
)
def test_other_commands_pass(command: str) -> None:
    assert decide({"command": command}) == ""


@pytest.mark.parametrize(
    ("path", "fix"),
    [
        ("data/raw/orders.csv", "transform.py"),
        (str(ROOT / "data" / "raw" / "2026.csv"), "transform.py"),
        ("./data/processed/orders.parquet", "make pipeline"),
        ("uv.lock", "uv add"),
    ],
)
def test_data_and_generated_files_cannot_be_hand_edited(path: str, fix: str) -> None:
    assert fix in denial({"file_path": path})


@pytest.mark.parametrize(
    "path", ["data/fixtures/orders.csv", "data/fixtures/expected/orders.csv", "src/transform.py"]
)
def test_fixtures_and_source_remain_editable(path: str) -> None:
    assert decide({"file_path": str(ROOT / path)}) == ""
