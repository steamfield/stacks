from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings


def test_defaults_and_env_override_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert Settings().environment == "development"
    Path(".env").write_text("ENVIRONMENT=production\nLOG_LEVEL=DEBUG\nPORT_API=9000\n")
    assert Settings().log_level == "DEBUG"
    monkeypatch.setenv("LOG_LEVEL", "ERROR")
    assert Settings().environment == "production"
    assert Settings().log_level == "ERROR"
    assert Settings(log_level="WARNING").log_level == "WARNING"


@pytest.mark.parametrize("key,value", [("ENVIRONMENT", "prodution"), ("LOG_LEVEL", "verbose")])
def test_invalid_env_fails_startup(key: str, value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError):
        Settings()


def test_cached_settings_are_explicitly_reset(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    try:
        first = get_settings()
        monkeypatch.setenv("ENVIRONMENT", "production")
        assert get_settings() is first
        get_settings.cache_clear()
        assert get_settings().environment == "production"
    finally:
        get_settings.cache_clear()
