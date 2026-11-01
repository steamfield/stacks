import io
import json

import pytest

from package_name.errors import EXIT_CODES, CliError, ErrorCode
from package_name.output import OutputOptions, color_enabled, render, render_error

FAILURE = CliError(ErrorCode.CONFIG, "cannot parse config.toml", "Fix the TOML syntax.")


class Terminal(io.StringIO):
    def isatty(self) -> bool:
        return True


def test_every_error_code_has_its_own_exit_status() -> None:
    assert set(EXIT_CODES) == set(ErrorCode)
    assert EXIT_CODES == {
        ErrorCode.INTERNAL: 1,
        ErrorCode.INVALID_INPUT: 2,
        ErrorCode.CONFIG: 3,
        ErrorCode.IO: 4,
        ErrorCode.INTERRUPTED: 130,
    }
    assert FAILURE.exit_code == 3


def test_human_result_goes_to_stdout(capsys: pytest.CaptureFixture[str]) -> None:
    render(OutputOptions(), {"greeting": "hi"}, "greeting: hi")
    captured = capsys.readouterr()
    assert captured.out == "greeting: hi\n"
    assert captured.err == ""


def test_json_result_is_one_document(capsys: pytest.CaptureFixture[str]) -> None:
    render(OutputOptions(json=True), {"greeting": "hi"}, "greeting: hi")
    assert json.loads(capsys.readouterr().out) == {"greeting": "hi"}


def test_human_error_has_code_message_and_suggestion(capsys: pytest.CaptureFixture[str]) -> None:
    render_error(OutputOptions(), FAILURE)
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "CONFIG: cannot parse config.toml\nSuggestion: Fix the TOML syntax.\n"


def test_json_error_goes_to_stderr(capsys: pytest.CaptureFixture[str]) -> None:
    render_error(OutputOptions(json=True), FAILURE)
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err) == {
        "error": {
            "code": "CONFIG",
            "message": "cannot parse config.toml",
            "suggestion": "Fix the TOML syntax.",
        }
    }


def test_color_needs_a_terminal_a_request_and_no_no_color(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert color_enabled(Terminal(), requested=True)
    assert not color_enabled(io.StringIO(), requested=True)
    assert not color_enabled(Terminal(), requested=False)
    monkeypatch.setenv("NO_COLOR", "")
    assert not color_enabled(Terminal(), requested=True)
