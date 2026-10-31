# API reference

Everything below is importable from the package root. Names not listed here,
including anything in an underscore module, are private and may change in any
release. `tests/test_public_api.py` fails when this page, `__all__` and the
code disagree, so a public name changes in all three at once, with a CHANGELOG
entry.

## Functions

### `parse_duration`

```python
def parse_duration(text: str) -> datetime.timedelta
```

Parses a duration such as `90s`, `1h30m` or `1d2h3m4s`. Each part is a whole
number and a unit: `d` (days), `h` (hours), `m` (minutes) or `s` (seconds).
Units appear at most once, largest first. Surrounding whitespace is ignored.

Raises `ParseError` for malformed text and `RangeError` for a duration longer
than `timedelta` can hold.

### `format_duration`

```python
def format_duration(value: datetime.timedelta) -> str
```

Formats a duration in its shortest form, largest unit first (`1h30m`; zero is
`0s`). Parsing the result returns the same value.

Raises `RangeError` for a negative duration or one with a fraction of a second.

## Exceptions

Every exception the library raises derives from `Error`. Each subclass also
derives from `ValueError`, so existing `except ValueError` handlers keep
working.

```text
Exception
 └── Error
      ├── ParseError (also ValueError)
      └── RangeError (also ValueError)
```

### `Error`

The base class. Catch it to handle any failure from this library.

### `ParseError`

The input text could not be parsed. Attributes: `text` (the input),
`position` (zero-based index of the first character that failed) and `reason`
(the message without the position).

### `RangeError`

A value has the right type but is outside what the library supports.

## Metadata

### `__version__`

The installed distribution's version, read from its metadata.
