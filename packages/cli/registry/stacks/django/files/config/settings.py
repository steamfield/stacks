"""Django settings. Every value that varies by deployment comes from `config.env.load`."""

import os
from pathlib import Path

import django_stubs_ext

from config.env import load
from config.logging import logging_config

# Lets runtime code subscript Django generics (ModelForm[Note]) the way the type stubs do.
django_stubs_ext.monkeypatch()

BASE_DIR = Path(__file__).resolve().parent.parent
ENV = load(os.environ, BASE_DIR)

SECRET_KEY = ENV.secret_key
DEBUG = ENV.debug
ALLOWED_HOSTS = list(ENV.allowed_hosts)
CSRF_TRUSTED_ORIGINS = list(ENV.csrf_trusted_origins)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "accounts",
    "core",
    "notes",
]

MIDDLEWARE = [
    # Outermost, so the request log sees the final status of every response.
    "core.middleware.RequestLogMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ENV.database_path,
        "OPTIONS": {
            # Writers take the lock up front and wait for it, so concurrent workers don't fail.
            "transaction_mode": "IMMEDIATE",
            "timeout": 5,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    },
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
# Production serves hashed, compressed copies that collectstatic (make build) writes to
# staticfiles/. Elsewhere whitenoise serves straight from the app and project static dirs.
STATIC_ROOT = BASE_DIR / "staticfiles" if ENV.production else None
WHITENOISE_USE_FINDERS = not ENV.production
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
        if ENV.production
        else "django.contrib.staticfiles.storage.StaticFilesStorage"
    },
}

SESSION_COOKIE_SECURE = ENV.production
CSRF_COOKIE_SECURE = ENV.production
SECURE_SSL_REDIRECT = ENV.secure_ssl_redirect
# The container healthcheck and load balancers probe over plain HTTP.
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]
SECURE_HSTS_SECONDS = ENV.hsts_seconds
SECURE_HSTS_INCLUDE_SUBDOMAINS = ENV.hsts_seconds > 0
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if ENV.behind_tls_proxy else None
# Preloading is a separate, hard-to-undo submission to browser vendors; opt in deliberately.
SILENCED_SYSTEM_CHECKS = ["security.W021"]

LOGGING = logging_config(ENV.log_level, json=ENV.log_format == "json")
