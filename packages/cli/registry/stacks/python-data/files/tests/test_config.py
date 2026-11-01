from __future__ import annotations

from pathlib import Path

import pytest

from package_name.config import ENV_PREFIX, Settings, load_settings
from package_name.errors import ErrorCode, PipelineError

ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"


def test_defaults_read_from_the_data_directories() -> None:
    settings = load_settings()
    assert settings.input_path == Path("data/raw")
    assert settings.output_dir == Path("data/processed")
    assert settings.top_products == 5


def test_flags_win_over_env_and_env_over_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text(f"{ENV_PREFIX}TOP_PRODUCTS=3\n{ENV_PREFIX}LOG_LEVEL=debug\n")
    assert load_settings().top_products == 3
    monkeypatch.setenv(f"{ENV_PREFIX}TOP_PRODUCTS", "4")
    settings = load_settings()
    assert (settings.top_products, settings.log_level) == (4, "debug")
    assert load_settings(top_products=9).top_products == 9


@pytest.mark.parametrize(("name", "value"), [("TOP_PRODUCTS", "0"), ("LOG_FORMAT", "xml")])
def test_invalid_values_are_config_errors(
    name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(f"{ENV_PREFIX}{name}", value)
    with pytest.raises(PipelineError) as raised:
        load_settings()
    assert raised.value.code is ErrorCode.CONFIG
    assert name.lower() in raised.value.message


def test_env_example_names_every_setting() -> None:
    names = {
        line.split("=", 1)[0].removeprefix(ENV_PREFIX).lower()
        for line in ENV_EXAMPLE.read_text().splitlines()
        if line and not line.startswith("#")
    }
    assert names == set(Settings.model_fields)
