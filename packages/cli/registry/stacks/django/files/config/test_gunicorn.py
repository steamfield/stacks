import importlib

import pytest

import config.gunicorn


def test_binds_to_web_host_and_port_web(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_HOST", "192.0.2.10")
    monkeypatch.setenv("PORT_WEB", "8123")
    settings = importlib.reload(config.gunicorn)
    assert settings.bind == "192.0.2.10:8123"
    assert settings.wsgi_app == "config.wsgi:application"
    assert settings.accesslog is None
    assert settings.control_socket_disable is True


def test_rejects_a_non_numeric_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT_WEB", "web")
    with pytest.raises(ValueError, match="invalid literal"):
        importlib.reload(config.gunicorn)
