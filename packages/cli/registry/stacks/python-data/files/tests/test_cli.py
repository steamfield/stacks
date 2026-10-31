from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from package_name.cli import run
from package_name.config import ENV_PREFIX

if TYPE_CHECKING:
    from pathlib import Path


def test_run_writes_outputs_and_a_text_summary(
    tmp_path: Path, orders_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    status = run(["run", "--input", str(orders_csv), "--output", str(tmp_path / "out")])
    captured = capsys.readouterr()
    assert status == 0
    assert "20 rows" in captured.out
    assert "6 rejected" in captured.out
    assert (tmp_path / "out" / "orders.parquet").is_file()


def test_run_json_summary_is_one_document(
    tmp_path: Path, orders_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    status = run(["run", "--input", str(orders_csv), "--output", str(tmp_path), "--json"])
    document = json.loads(capsys.readouterr().out)
    assert status == 0
    assert document["rows"] == {"read": 20, "clean": 13, "rejected": 6, "duplicates": 1}
    assert set(document["outputs"]) == {"orders", "rejects", "revenue_by_region", "top_products"}


def test_settings_come_from_the_environment(
    tmp_path: Path,
    orders_csv: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv(f"{ENV_PREFIX}INPUT_PATH", str(orders_csv))
    monkeypatch.setenv(f"{ENV_PREFIX}OUTPUT_DIR", str(tmp_path / "env-out"))
    assert run(["run"]) == 0
    assert str(orders_csv) in capsys.readouterr().out
    assert (tmp_path / "env-out" / "top_products.parquet").is_file()


def test_compare_matches_and_mismatches(
    tmp_path: Path, orders_csv: Path, expected_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run(["run", "--input", str(orders_csv), "--output", str(tmp_path)])
    capsys.readouterr()
    assert run(["compare", str(tmp_path), str(expected_dir), "--json"]) == 0
    assert json.loads(capsys.readouterr().out) == {"matched": True}

    (tmp_path / "orders.parquet").unlink()
    assert run(["compare", str(tmp_path), str(expected_dir)]) == 7
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("MISMATCH: outputs differ")
    assert "orders:" in captured.err


@pytest.mark.parametrize(
    ("argv", "status", "code"),
    [
        (["run", "--input", "absent"], 4, "INPUT"),
        (["run", "--top", "0"], 3, "CONFIG"),
        (["run", "--unknown"], 2, "USAGE"),
        ([], 2, "USAGE"),
    ],
)
def test_failures_map_to_exit_codes_and_one_json_error(
    argv: list[str], status: int, code: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run([*argv, "--json"]) == status
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["error"]["code"] == code


def test_unexpected_errors_are_internal_without_a_traceback(
    tmp_path: Path,
    orders_csv: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr("package_name.cli.run_pipeline", explode)
    assert run(["run", "--input", str(orders_csv), "--output", str(tmp_path)]) == 1
    captured = capsys.readouterr()
    assert captured.err.startswith("INTERNAL: unexpected error")
    assert "boom" not in captured.err


def test_help_and_version_exit_zero(capsys: pytest.CaptureFixture[str]) -> None:
    assert run(["--help"]) == 0
    assert "compare" in capsys.readouterr().out
    assert run(["--version"]) == 0
    assert capsys.readouterr().out.strip()
