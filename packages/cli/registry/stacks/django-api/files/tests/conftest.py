import pytest
from django.core.cache import cache
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def fresh_throttle_counts() -> None:
    """Throttle counts live in the cache, which outlives a test; each test starts from zero."""
    cache.clear()


@pytest.fixture
def api() -> APIClient:
    return APIClient()
