"""The public API is a contract: changing it must be deliberate.

When you add, rename or remove a public name, update `PUBLIC`, `docs/api.md`
and the CHANGELOG in the same change.
"""

import logging
import re
from importlib.metadata import version
from pathlib import Path

import package_name

PUBLIC = {
    "Error",
    "ParseError",
    "RangeError",
    "__version__",
    "format_duration",
    "parse_duration",
}

DOCS = Path(__file__).resolve().parents[1] / "docs" / "api.md"


def test_all_lists_exactly_the_public_names() -> None:
    assert set(package_name.__all__) == PUBLIC
    assert len(package_name.__all__) == len(PUBLIC)


def test_every_public_name_exists() -> None:
    for name in PUBLIC:
        assert hasattr(package_name, name), name


def test_every_public_name_is_documented() -> None:
    documented = set(re.findall(r"^#+ `([A-Za-z_]+)", DOCS.read_text(encoding="utf-8"), re.M))
    assert documented == PUBLIC


def test_version_comes_from_the_installed_metadata() -> None:
    assert package_name.__version__ == version(package_name.__name__.replace("_", "-"))


def test_the_library_leaves_logging_to_the_application() -> None:
    logger = logging.getLogger(package_name.__name__)
    assert any(isinstance(handler, logging.NullHandler) for handler in logger.handlers)
    assert logger.level == logging.NOTSET
    assert logger.propagate
