from datetime import timedelta

import pytest

from package_name import Error, ParseError, RangeError, format_duration, parse_duration


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("0s", timedelta(0)),
        ("90s", timedelta(seconds=90)),
        ("1h30m", timedelta(hours=1, minutes=30)),
        ("2d", timedelta(days=2)),
        ("1d2h3m4s", timedelta(days=1, hours=2, minutes=3, seconds=4)),
        ("  15m\n", timedelta(minutes=15)),
    ],
)
def test_parse_duration(text: str, expected: timedelta) -> None:
    assert parse_duration(text) == expected


@pytest.mark.parametrize(
    ("text", "reason", "position"),
    [
        ("", "empty duration", 0),
        ("   ", "empty duration", 3),
        ("h", "expected a number", 0),
        ("10", "missing unit", 2),
        ("5w", "unknown unit 'w'", 1),
        ("1m1h", "unit 'h' repeated or out of order", 3),
        ("1s1s", "unit 's' repeated or out of order", 3),
        (" 1h 30m", "expected a number", 3),
        ("1H", "missing unit", 1),
    ],
)
def test_parse_errors_say_where(text: str, reason: str, position: int) -> None:
    with pytest.raises(ParseError) as caught:
        parse_duration(text)
    assert caught.value.reason == reason
    assert caught.value.position == position
    assert caught.value.text == text
    assert str(caught.value) == f"{reason} at position {position} in {text!r}"


def test_parse_rejects_durations_timedelta_cannot_hold() -> None:
    with pytest.raises(RangeError, match="longer than timedelta allows"):
        parse_duration("99999999999d")


@pytest.mark.parametrize("digits", [21, 5000])
def test_parse_rejects_numbers_too_long_to_convert(digits: int) -> None:
    with pytest.raises(RangeError, match="longer than timedelta allows"):
        parse_duration("9" * digits + "s")


def test_parse_ignores_leading_zeros_when_bounding_numbers() -> None:
    assert parse_duration("0" * 30 + "5s") == timedelta(seconds=5)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (timedelta(0), "0s"),
        (timedelta(seconds=90), "1m30s"),
        (timedelta(hours=1), "1h"),
        (timedelta(days=3, seconds=5), "3d5s"),
    ],
)
def test_format_duration(value: timedelta, expected: str) -> None:
    assert format_duration(value) == expected


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (timedelta(seconds=-1), "must not be negative"),
        (timedelta(milliseconds=1500), "must be whole seconds"),
    ],
)
def test_format_rejects_unsupported_values(value: timedelta, message: str) -> None:
    with pytest.raises(RangeError, match=message):
        format_duration(value)


@pytest.mark.parametrize("error", [ParseError("bad", text="x", position=0), RangeError("big")])
def test_every_error_is_an_error_and_a_value_error(error: Error) -> None:
    assert isinstance(error, Error)
    assert isinstance(error, ValueError)
