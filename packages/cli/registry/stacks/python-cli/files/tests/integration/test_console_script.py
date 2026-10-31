"""Run the installed console script as a separate process, as a user would."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import package_name
from package_name.config import APP_NAME

pytestmark = pytest.mark.integration


def script() -> str:
    found = shutil.which(APP_NAME, path=str(Path(sys.executable).parent))
    assert found, f"{APP_NAME} is not installed in this environment; run make install"
    return found


def run(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    env = {"HOME": str(cwd), "PATH": os.environ["PATH"], "NO_COLOR": "1"}
    return subprocess.run(
        [script(), *args], cwd=cwd, env=env, capture_output=True, text=True, check=False
    )


def test_config_show_json(tmp_path: Path) -> None:
    result = run("--json", "config", "show", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["greeting"] == "Hello, world!"
    assert result.stderr == ""


def test_home_config_file_is_read(tmp_path: Path) -> None:
    config = tmp_path / ".config" / APP_NAME / "config.toml"
    config.parent.mkdir(parents=True)
    config.write_text('greeting = "Hello from the file"\n')
    result = run("config", "show", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert 'greeting: "Hello from the file"' in result.stdout


def test_unknown_command_exits_2_with_a_json_error(tmp_path: Path) -> None:
    result = run("--json", "nope", cwd=tmp_path)
    assert result.returncode == 2
    assert result.stdout == ""
    assert json.loads(result.stderr)["error"]["code"] == "INVALID_INPUT"


def test_module_entry_point_matches_the_script(tmp_path: Path) -> None:
    env = {"HOME": str(tmp_path), "PATH": os.environ["PATH"]}
    result = subprocess.run(
        [sys.executable, "-m", package_name.__name__, "--version"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith(f"{APP_NAME} ")
