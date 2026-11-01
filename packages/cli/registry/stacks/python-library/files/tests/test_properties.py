"""Properties that hold for every input Hypothesis generates, not only the examples."""

from datetime import timedelta

from hypothesis import given
from hypothesis import strategies as st

from package_name import ParseError, RangeError, format_duration, parse_duration

durations = st.timedeltas(min_value=timedelta(0)).map(
    lambda value: value - timedelta(microseconds=value.microseconds)
)


@given(durations)
def test_format_then_parse_returns_the_same_duration(value: timedelta) -> None:
    assert parse_duration(format_duration(value)) == value


@given(st.text())
def test_parse_accepts_or_raises_a_library_error(text: str) -> None:
    try:
        value = parse_duration(text)
    except ParseError as error:
        assert 0 <= error.position <= len(text)
    except RangeError:
        pass
    else:
        assert parse_duration(format_duration(value)) == value
