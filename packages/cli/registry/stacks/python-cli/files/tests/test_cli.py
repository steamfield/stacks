"""Command tests: run the real command tree in process and read both streams."""

import json
from importlib.metadata import version
from pathlib import Path
from typing import Any, NoReturn

import pytest

from package_name import cli
from package_name.config import APP_NAME, ENV_PREFIX


def run(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, str, str]:
    code = cli.run(list(args))
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_no_command_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = run(capsys)
    assert code == 0
    assert "Usage:" in out
    assert err == ""


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (["--version"], f"{APP_NAME} {version(APP_NAME)}\n"),
        (["--json", "--version"], json.dumps({"version": version(APP_NAME)}) + "\n"),
    ],
)
def test_version(capsys: pytest.CaptureFixture[str], args: list[str], expected: str) -> None:
    assert run(capsys, *args) == (0, expected, "")


def test_config_show_human(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = run(capsys, "config", "show")
    assert code == 0
    assert 'greeting: "Hello, world!"' in out
    assert 'output: "text"' in out
    assert err == ""


def test_config_show_json_reads_env_and_flags(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(f"{ENV_PREFIX}GREETING", "Hi from env")
    code, out, err = run(capsys, "--json", "--no-color", "config", "show")
    assert code == 0
    assert json.loads(out) == {
        "greeting": "Hi from env",
        "output": "json",
        "verbose": False,
        "color": False,
    }
    assert err == ""


def test_verbose_logs_to_stderr_only(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = run(capsys, "--verbose", "--json", "config", "show")
    assert code == 0
    assert json.loads(out)["verbose"] is True
    assert json.loads(err.splitlines()[0])["event"] == "config loaded"


@pytest.mark.parametrize("args", [["nope"], ["--bogus"], ["config"], ["config", "show", "extra"]])
def test_usage_errors_exit_2(capsys: pytest.CaptureFixture[str], args: list[str]) -> None:
    code, out, err = run(capsys, *args)
    assert code == 2
    assert out == ""
    assert err.startswith("INVALID_INPUT: ")
    assert err.count("Suggestion: ") == 1


def test_json_usage_error_is_one_document_on_stderr(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = run(capsys, "--json", "nope")
    assert code == 2
    assert out == ""
    assert json.loads(err)["error"]["code"] == "INVALID_INPUT"


def test_config_error_exits_1(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    bad = tmp_path / "bad.toml"
    bad.write_text("greeting = [\n")
    code, out, err = run(capsys, "--json", "--config", str(bad), "config", "show")
    assert code == 1
    assert out == ""
    error = json.loads(err)["error"]
    assert error["code"] == "CONFIG"
    assert error["suggestion"]


def broken_settings(*_args: Any) -> NoReturn:
    message = "secret detail"
    raise RuntimeError(message)


def test_unexpected_errors_hide_details(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "load_settings", broken_settings)
    code, out, err = run(capsys, "config", "show")
    assert code == 1
    assert out == ""
    assert err.startswith("INTERNAL: unexpected error\n")
    assert "secret detail" not in err


def test_verbose_logs_the_traceback(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "load_settings", broken_settings)
    code, _, err = run(capsys, "--verbose", "config", "show")
    assert code == 1
    assert "Traceback" in err
    assert "RuntimeError" in err
