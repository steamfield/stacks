from pathlib import Path

import pytest

from package_name.config import APP_NAME, ENV_PREFIX, default_config_file, load_settings
from package_name.errors import CliError, ErrorCode


def write_default_config(text: str) -> Path:
    path = default_config_file()
    path.parent.mkdir(parents=True)
    path.write_text(text)
    return path


def test_defaults_without_a_config_file() -> None:
    settings = load_settings(None, {})
    assert settings.greeting == "Hello, world!"
    assert settings.output == "text"
    assert settings.verbose is False
    assert settings.color is True


def test_default_file_follows_xdg_config_home(tmp_path: Path) -> None:
    assert default_config_file() == tmp_path / "home" / ".config" / APP_NAME / "config.toml"


def test_default_file_falls_back_to_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("XDG_CONFIG_HOME")
    assert default_config_file() == tmp_path / "home" / ".config" / APP_NAME / "config.toml"


def test_each_layer_overrides_the_one_below(monkeypatch: pytest.MonkeyPatch) -> None:
    write_default_config('greeting = "from file"\noutput = "json"\n')
    assert load_settings(None, {}).greeting == "from file"
    monkeypatch.setenv(f"{ENV_PREFIX}GREETING", "from env")
    assert load_settings(None, {}).greeting == "from env"
    assert load_settings(None, {}).output == "json"
    monkeypatch.setenv(f"{ENV_PREFIX}OUTPUT", "text")
    assert load_settings(None, {}).output == "text"
    assert load_settings(None, {"output": "json"}).output == "json"


def test_explicit_file_replaces_the_default(tmp_path: Path) -> None:
    write_default_config('greeting = "default file"\n')
    chosen = tmp_path / "chosen.toml"
    chosen.write_text('greeting = "chosen file"\n')
    assert load_settings(chosen, {}).greeting == "chosen file"


def test_missing_explicit_file_is_a_config_error(tmp_path: Path) -> None:
    with pytest.raises(CliError) as caught:
        load_settings(tmp_path / "missing.toml", {})
    assert caught.value.code is ErrorCode.CONFIG
    assert "--config" in caught.value.suggestion


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("greeting = [\n", "cannot parse"),
        ('greeting = "   "\n', "greeting"),
        ('output = "yaml"\n', "output"),
        ("colour = false\n", "colour"),
    ],
)
def test_bad_files_are_config_errors(text: str, message: str) -> None:
    path = write_default_config(text)
    with pytest.raises(CliError) as caught:
        load_settings(None, {})
    assert caught.value.code is ErrorCode.CONFIG
    assert message in caught.value.message
    assert str(path) in f"{caught.value.message} {caught.value.suggestion}"


def test_invalid_env_value_is_a_config_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(f"{ENV_PREFIX}VERBOSE", "sometimes")
    with pytest.raises(CliError) as caught:
        load_settings(None, {})
    assert caught.value.code is ErrorCode.CONFIG
    assert "verbose" in caught.value.message
