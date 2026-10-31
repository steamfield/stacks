from django.apps import AppConfig

from config.logging import configure_structlog


class CoreConfig(AppConfig):
    """Cross-cutting pieces: request logging, the health view and error pages."""

    name = "core"

    def ready(self) -> None:
        configure_structlog()
