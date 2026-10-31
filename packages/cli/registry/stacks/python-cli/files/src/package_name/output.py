"""Results go to stdout, everything else to stderr. JSON mode writes one document per stream."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING, TextIO

if TYPE_CHECKING:
    from collections.abc import Mapping

    from package_name.errors import CliError


@dataclass(frozen=True)
class OutputOptions:
    json: bool = False
    color: bool = True


def color_enabled(stream: TextIO, *, requested: bool) -> bool:
    """Color needs a request, a terminal and no NO_COLOR variable (even an empty one)."""
    return requested and "NO_COLOR" not in os.environ and stream.isatty()


def render(options: OutputOptions, value: Mapping[str, object], human: str) -> None:
    if options.json:
        sys.stdout.write(json.dumps(value) + "\n")
    else:
        sys.stdout.write(human + "\n")


def render_error(options: OutputOptions, error: CliError) -> None:
    if options.json:
        document = {
            "error": {
                "code": error.code,
                "message": error.message,
                "suggestion": error.suggestion,
            }
        }
        sys.stderr.write(json.dumps(document) + "\n")
        return
    label = str(error.code)
    if color_enabled(sys.stderr, requested=options.color):
        label = f"\x1b[31m{label}\x1b[0m"
    sys.stderr.write(f"{label}: {error.message}\nSuggestion: {error.suggestion}\n")
