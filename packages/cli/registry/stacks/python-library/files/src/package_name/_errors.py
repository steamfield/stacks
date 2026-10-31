"""The exception hierarchy. Every error the library raises is an `Error`."""

from __future__ import annotations


class Error(Exception):
    """Base class for every error this library raises.

    Catch `Error` to handle any failure from the library. Each subclass also
    derives from the built-in exception a caller would expect, so
    `except ValueError` keeps working.
    """


class ParseError(Error, ValueError):
    """Text could not be parsed.

    Attributes:
        text: The input that failed to parse.
        position: The zero-based index of the first character that failed.
    """

    def __init__(self, reason: str, *, text: str, position: int) -> None:
        super().__init__(f"{reason} at position {position} in {text!r}")
        self.reason = reason
        self.text = text
        self.position = position


class RangeError(Error, ValueError):
    """A value is the right type but outside what the library supports."""
