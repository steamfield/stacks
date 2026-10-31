import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api() -> APIClient:
    return APIClient()
