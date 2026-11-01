"""Read the process environment into validated settings values.

`config/settings.py` calls `load` once at import. Nothing else reads `os.environ` for app settings;
a new setting gets a field here, a test in `config/test_env.py` and a line in `.env.example`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal, cast, get_args

from django.core.exceptions import ImproperlyConfigured

if TYPE_CHECKING:
    from collections.abc import Mapping

Environment = Literal["development", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["console", "json"]

# Development only: load() refuses to start production without DJANGO_SECRET_KEY.
DEV_SECRET_KEY = "django-insecure-development-only"  # noqa: S105

# Every variable load() reads. tests check .env.example documents each one.
VARIABLES = (
    "DJANGO_ENV",
    "DJANGO_DEBUG",
    "DJANGO_SECRET_KEY",
    "DJANGO_ALLOWED_HOSTS",
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    "DJANGO_DB_PATH",
    "DJANGO_SECURE_SSL_REDIRECT",
    "DJANGO_HSTS_SECONDS",
    "DJANGO_BEHIND_TLS_PROXY",
    "LOG_LEVEL",
    "LOG_FORMAT",
)

_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})


@dataclass(frozen=True, slots=True)
class Env:
    environment: Environment
    debug: bool
    secret_key: str
    allowed_hosts: tuple[str, ...]
    csrf_trusted_origins: tuple[str, ...]
    database_path: Path
    secure_ssl_redirect: bool
    hsts_seconds: int
    behind_tls_proxy: bool
    log_level: LogLevel
    log_format: LogFormat

    @property
    def production(self) -> bool:
        return self.environment == "production"


def load(environ: Mapping[str, str], base_dir: Path) -> Env:
    """Validate the environment, failing fast with the variable's name on a bad value."""
    environment = cast(
        "Environment", _choice(environ, "DJANGO_ENV", get_args(Environment), "development")
    )
    production = environment == "production"
    debug = _bool(environ, "DJANGO_DEBUG", default=not production)
    if production and debug:
        raise ImproperlyConfigured("DJANGO_DEBUG must be off when DJANGO_ENV is production.")
    secret_key = environ.get("DJANGO_SECRET_KEY", "").strip()
    if production and not secret_key:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY is required when DJANGO_ENV is production.")
    database_path = Path(environ.get("DJANGO_DB_PATH", "").strip() or "var/db.sqlite3")
    return Env(
        environment=environment,
        debug=debug,
        secret_key=secret_key or DEV_SECRET_KEY,
        allowed_hosts=_list(environ, "DJANGO_ALLOWED_HOSTS", ("localhost", "127.0.0.1")),
        csrf_trusted_origins=_list(environ, "DJANGO_CSRF_TRUSTED_ORIGINS", ()),
        database_path=database_path if database_path.is_absolute() else base_dir / database_path,
        secure_ssl_redirect=_bool(environ, "DJANGO_SECURE_SSL_REDIRECT", default=production),
        hsts_seconds=_seconds(environ, "DJANGO_HSTS_SECONDS", default=3600 if production else 0),
        behind_tls_proxy=_bool(environ, "DJANGO_BEHIND_TLS_PROXY", default=False),
        log_level=cast("LogLevel", _choice(environ, "LOG_LEVEL", get_args(LogLevel), "INFO")),
        log_format=cast(
            "LogFormat",
            _choice(environ, "LOG_FORMAT", get_args(LogFormat), "console" if debug else "json"),
        ),
    )


def _raw(environ: Mapping[str, str], name: str) -> str | None:
    value = environ.get(name, "").strip()
    return value or None


def _choice(environ: Mapping[str, str], name: str, allowed: tuple[str, ...], default: str) -> str:
    value = _raw(environ, name)
    if value is None:
        return default
    if value not in allowed:
        raise ImproperlyConfigured(f"{name} must be one of {', '.join(allowed)}.")
    return value


def _bool(environ: Mapping[str, str], name: str, *, default: bool) -> bool:
    value = _raw(environ, name)
    if value is None:
        return default
    if value.lower() in _TRUE:
        return True
    if value.lower() in _FALSE:
        return False
    raise ImproperlyConfigured(f"{name} must be a boolean (1/0, true/false, yes/no, on/off).")


def _seconds(environ: Mapping[str, str], name: str, *, default: int) -> int:
    value = _raw(environ, name)
    if value is None:
        return default
    # isascii: isdigit alone accepts digits such as "²" that int() rejects.
    if not (value.isascii() and value.isdigit()):
        raise ImproperlyConfigured(f"{name} must be a whole number of seconds.")
    return int(value)


def _list(environ: Mapping[str, str], name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = _raw(environ, name)
    if value is None:
        return default
    return tuple(item.strip() for item in value.split(",") if item.strip())
