import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("path", ["openapi.json", "./openapi.json", "app/../openapi.json"])
def test_generated_openapi_cannot_be_hand_edited(path: str) -> None:
    result = subprocess.run(  # noqa: S603 - fixed local hook; paths are JSON input, never commands.
        ["/bin/bash", str(ROOT / ".claude/hooks/guard-openapi.sh")],
        input=json.dumps({"tool_input": {"file_path": path}}),
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(ROOT)},
        text=True,
        capture_output=True,
        check=True,
    )
    decision = json.loads(result.stdout)["hookSpecificOutput"]
    assert decision["permissionDecision"] == "deny"
    assert "make openapi" in decision["permissionDecisionReason"]


def test_source_edits_remain_allowed() -> None:
    result = subprocess.run(  # noqa: S603 - fixed local hook, no shell interpolation.
        ["/bin/bash", str(ROOT / ".claude/hooks/guard-openapi.sh")],
        input=json.dumps({"tool_input": {"file_path": str(ROOT / "app/main.py")}}),
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(ROOT)},
        text=True,
        capture_output=True,
        check=True,
    )
    assert result.stdout == ""
