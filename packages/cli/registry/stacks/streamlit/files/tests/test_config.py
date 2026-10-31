from __future__ import annotations

from pathlib import Path

import pytest

from package_name.config import ENV_PREFIX, Settings, load_settings
from package_name.errors import AppError, ErrorCode

ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"


def test_defaults_read_the_sample() -> None:
    settings = load_settings()
    assert settings.data_path == Path("data/sample.csv")
    assert (settings.log_level, settings.log_format) == ("info", "console")


def test_env_wins_over_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text(f"{ENV_PREFIX}DATA_PATH=a.csv\n{ENV_PREFIX}LOG_LEVEL=debug\n")
    assert load_settings().data_path == Path("a.csv")
    monkeypatch.setenv(f"{ENV_PREFIX}DATA_PATH", "b.csv")
    settings = load_settings()
    assert (settings.data_path, settings.log_level) == (Path("b.csv"), "debug")


@pytest.mark.parametrize(("name", "value"), [("LOG_LEVEL", "loud"), ("LOG_FORMAT", "xml")])
def test_invalid_values_are_config_errors(
    name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(f"{ENV_PREFIX}{name}", value)
    with pytest.raises(AppError) as raised:
        load_settings()
    assert raised.value.code is ErrorCode.CONFIG
    assert raised.value.heading == "Configuration error"
    assert name.lower() in raised.value.message


def test_env_example_names_every_setting() -> None:
    names = {
        line.split("=", 1)[0].removeprefix(ENV_PREFIX).lower()
        for line in ENV_EXAMPLE.read_text().splitlines()
        if line and not line.startswith("#")
    }
    assert names == set(Settings.model_fields)
