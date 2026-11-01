"""Durations as compact text: `1d2h3m4s` to `timedelta` and back."""

from __future__ import annotations

import re
from datetime import timedelta

from ._errors import ParseError, RangeError

# Largest unit first. Parsing requires this order; formatting writes it.
UNITS: tuple[tuple[str, int], ...] = (("d", 86_400), ("h", 3_600), ("m", 60), ("s", 1))
_SECONDS = dict(UNITS)
_RANK = {unit: rank for rank, (unit, _) in enumerate(UNITS)}
_PART = re.compile(r"([0-9]+)([a-z]?)")
# More significant digits than any duration timedelta holds; longer numbers are never converted,
# since int() refuses (and is slow on) very long digit strings.
_MAX_DIGITS = 20


def parse_duration(text: str) -> timedelta:
    """Parse a duration such as `90s`, `1h30m` or `2d`.

    Each part is a whole number followed by a unit (`d`, `h`, `m` or `s`).
    Units appear at most once, largest first. Surrounding whitespace is
    ignored; whitespace between parts is not.

    Raises:
        ParseError: The text is empty, has an unknown or missing unit, or
            repeats a unit or lists one out of order.
        RangeError: The duration is longer than `timedelta` can hold.
    """
    stripped = text.strip()
    offset = len(text) - len(text.lstrip())
    if not stripped:
        raise ParseError("empty duration", text=text, position=offset)
    seconds = 0
    previous = -1
    position = 0
    while position < len(stripped):
        match = _PART.match(stripped, position)
        if match is None:
            raise ParseError("expected a number", text=text, position=offset + position)
        number, unit = match.groups()
        if unit not in _RANK:
            reason = f"unknown unit {unit!r}" if unit else "missing unit"
            raise ParseError(reason, text=text, position=offset + match.start(2))
        if _RANK[unit] <= previous:
            reason = f"unit {unit!r} repeated or out of order"
            raise ParseError(reason, text=text, position=offset + match.start(2))
        previous = _RANK[unit]
        if len(number.lstrip("0")) > _MAX_DIGITS:
            raise _too_long(stripped)
        seconds += int(number) * _SECONDS[unit]
        position = match.end()
    try:
        return timedelta(seconds=seconds)
    except OverflowError:
        raise _too_long(stripped) from None


def _too_long(stripped: str) -> RangeError:
    return RangeError(f"duration {stripped!r} is longer than timedelta allows")


def format_duration(value: timedelta) -> str:
    """Format a duration in its shortest form, largest unit first: `1h30m`.

    Zero formats as `0s`. `parse_duration(format_duration(value)) == value`
    for every value this function accepts.

    Raises:
        RangeError: The duration is negative or not a whole number of seconds.
    """
    if value < timedelta(0):
        raise RangeError(f"durations must not be negative, got {value!r}")
    if value.microseconds:
        raise RangeError(f"durations must be whole seconds, got {value!r}")
    remaining = value.days * 86_400 + value.seconds
    if remaining == 0:
        return "0s"
    parts: list[str] = []
    for unit, size in UNITS:
        count, remaining = divmod(remaining, size)
        if count:
            parts.append(f"{count}{unit}")
    return "".join(parts)
