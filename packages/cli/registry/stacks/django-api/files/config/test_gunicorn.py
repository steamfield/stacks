import importlib

import pytest

import config.gunicorn


def test_binds_to_api_host_and_port_api(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_HOST", "192.0.2.10")
    monkeypatch.setenv("PORT_API", "8123")
    settings = importlib.reload(config.gunicorn)
    assert settings.bind == "192.0.2.10:8123"
    assert settings.wsgi_app == "config.wsgi:application"
    assert settings.accesslog is None
    assert settings.control_socket_disable is True


def test_rejects_a_non_numeric_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT_API", "api")
    with pytest.raises(ValueError, match="invalid literal"):
        importlib.reload(config.gunicorn)
