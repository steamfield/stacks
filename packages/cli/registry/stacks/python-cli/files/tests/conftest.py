from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest

from package_name.config import ENV_PREFIX

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test gets an empty home and config directory and none of the tool's variables."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home / ".config"))
    monkeypatch.delenv("NO_COLOR", raising=False)
    for name in list(os.environ):
        if name.startswith(ENV_PREFIX):
            monkeypatch.delenv(name)
    monkeypatch.chdir(tmp_path)
