"""Compare pipeline output with expected CSV files as frames: values and types, never bytes."""

from __future__ import annotations

from typing import TYPE_CHECKING

import polars as pl
from polars.testing import assert_frame_equal

from package_name.errors import ErrorCode, PipelineError

if TYPE_CHECKING:
    from pathlib import Path


def compare_outputs(actual_dir: Path, expected_dir: Path) -> list[str]:
    """Check each `<name>.csv` in `expected_dir` against `<name>.parquet` in `actual_dir`.

    Returns one line per difference; an empty list means every expected file matched. The
    expected CSV is parsed with the Parquet file's schema, so types are compared too.
    """
    expected_files = sorted(expected_dir.glob("*.csv"))
    if not expected_files:
        raise PipelineError(
            ErrorCode.INPUT,
            f"no expected CSV files in {expected_dir}",
            "Pass the directory that holds the expected <output>.csv files.",
        )
    problems: list[str] = []
    for expected_file in expected_files:
        actual_file = actual_dir / f"{expected_file.stem}.parquet"
        if not actual_file.is_file():
            problems.append(f"{expected_file.stem}: {actual_file} is missing")
            continue
        actual = pl.read_parquet(actual_file)
        try:
            expected = pl.read_csv(expected_file, schema=actual.schema)
            assert_frame_equal(actual, expected)
        except (AssertionError, pl.exceptions.PolarsError) as error:
            detail = " ".join(str(error).split())
            problems.append(f"{expected_file.stem}: {detail}")
    return problems
