import re
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from config.env import DEV_SECRET_KEY, VARIABLES, load

BASE = Path("/srv/app")
PRODUCTION = {"DJANGO_ENV": "production", "DJANGO_SECRET_KEY": "k" * 50}


def test_development_defaults() -> None:
    env = load({}, BASE)
    assert env.environment == "development"
    assert env.debug is True
    assert env.secret_key == DEV_SECRET_KEY
    assert env.allowed_hosts == ("localhost", "127.0.0.1")
    assert env.database_path == BASE / "var/db.sqlite3"
    assert env.secure_ssl_redirect is False
    assert env.hsts_seconds == 0
    assert env.anon_rate == "60/minute"
    assert env.log_level == "INFO"
    assert env.log_format == "console"


def test_production_defaults_are_secure() -> None:
    env = load(PRODUCTION, BASE)
    assert env.production
    assert env.debug is False
    assert env.secure_ssl_redirect is True
    assert env.hsts_seconds == 3600
    assert env.log_format == "json"


def test_production_requires_a_secret_key() -> None:
    with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY"):
        load({"DJANGO_ENV": "production", "DJANGO_SECRET_KEY": "  "}, BASE)


def test_production_refuses_debug() -> None:
    with pytest.raises(ImproperlyConfigured, match="DJANGO_DEBUG"):
        load({**PRODUCTION, "DJANGO_DEBUG": "1"}, BASE)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("DJANGO_ENV", "staging"),
        ("DJANGO_DEBUG", "maybe"),
        ("DJANGO_HSTS_SECONDS", "-1"),
        ("DJANGO_HSTS_SECONDS", "²"),
        ("DJANGO_ANON_RATE", "60"),
        ("DJANGO_ANON_RATE", "0/minute"),
        ("DJANGO_ANON_RATE", "10/week"),
        ("LOG_LEVEL", "info"),
        ("LOG_FORMAT", "xml"),
    ],
)
def test_invalid_values_name_the_variable(name: str, value: str) -> None:
    with pytest.raises(ImproperlyConfigured, match=name):
        load({name: value}, BASE)


def test_lists_and_paths() -> None:
    env = load(
        {
            "DJANGO_ALLOWED_HOSTS": " example.com, ,www.example.com ",
            "DJANGO_CSRF_TRUSTED_ORIGINS": "https://example.com",
            "DJANGO_DB_PATH": "/data/app.sqlite3",
            "DJANGO_BEHIND_TLS_PROXY": "yes",
            "DJANGO_ANON_RATE": "1000/hour",
        },
        BASE,
    )
    assert env.anon_rate == "1000/hour"
    assert env.allowed_hosts == ("example.com", "www.example.com")
    assert env.csrf_trusted_origins == ("https://example.com",)
    assert env.database_path == Path("/data/app.sqlite3")
    assert env.behind_tls_proxy is True


def test_env_example_documents_every_variable() -> None:
    example = (Path(__file__).resolve().parent.parent / ".env.example").read_text()
    documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]*)=", example, flags=re.MULTILINE))
    assert set(VARIABLES) <= documented
