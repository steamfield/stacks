"""Check an installed wheel the way a user's environment sees it.

Run by `make smoke` with the throwaway environment's interpreter and `-I`, from
a directory outside the project, so the source tree is never on `sys.path`.

Usage: python -I smoke.py <import name> <distribution name>
"""

from __future__ import annotations

import importlib
import sys
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path


def check(ok: object, problem: str) -> None:
    if not ok:
        raise SystemExit(f"smoke: {problem}")


def main(module_name: str, distribution: str) -> None:
    module = importlib.import_module(module_name)
    location = Path(module.__file__ or "").resolve()
    check("site-packages" in location.parts, f"imported from {location}, not the installed wheel")
    check(files(module_name).joinpath("py.typed").is_file(), "py.typed is missing from the wheel")
    check(module.__version__ == version(distribution), "__version__ disagrees with the metadata")
    missing = [name for name in module.__all__ if not hasattr(module, name)]
    check(not missing, f"__all__ names missing from the installed package: {missing}")
    print(f"{distribution} {module.__version__}: {len(module.__all__)} public names")


if __name__ == "__main__":
    main(*sys.argv[1:3])
