"""The command line, and the one place that turns failures into exit statuses.

`run` executes the pipeline; `compare` checks its output against expected files. Results go
to stdout (text, or one JSON document with --json); logs and errors go to stderr.
"""

from __future__ import annotations

import argparse
import json
import sys
from importlib.metadata import version as package_version
from pathlib import Path
from typing import TYPE_CHECKING, Any, NoReturn

import structlog

from package_name.compare import compare_outputs
from package_name.config import APP_NAME, ENV_PREFIX, Settings, load_settings
from package_name.errors import ErrorCode, PipelineError
from package_name.log import configure_logging
from package_name.pipeline import run_pipeline

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence


class Parser(argparse.ArgumentParser):
    """argparse that raises a usage error instead of printing it and exiting."""

    def error(self, message: str) -> NoReturn:
        raise PipelineError(ErrorCode.USAGE, message, f"Run {APP_NAME} --help for usage.")


def build_parser() -> Parser:
    parser = Parser(prog=APP_NAME, description="Turn raw order CSVs into clean Parquet.")
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {package_version(APP_NAME)}"
    )
    commands = parser.add_subparsers(dest="command", required=True, parser_class=Parser)

    run = commands.add_parser("run", help="Run the pipeline and write Parquet outputs.")
    run.add_argument(
        "--input", type=Path, help="A CSV file or a directory of them (default: data/raw)."
    )
    run.add_argument(
        "--output", type=Path, help="Directory for the Parquet files (default: data/processed)."
    )
    run.add_argument("--top", type=int, help="How many products the top-products query keeps.")
    run.add_argument("--json", action="store_true", help="Write the summary as JSON.")

    compare = commands.add_parser("compare", help="Compare outputs with expected CSV files.")
    compare.add_argument("actual", type=Path, help="Directory holding the Parquet outputs.")
    compare.add_argument("expected", type=Path, help="Directory holding <output>.csv files.")
    compare.add_argument("--json", action="store_true", help="Write the result as JSON.")
    return parser


def flags(args: argparse.Namespace) -> dict[str, Any]:
    """Only the flags given on the command line, so unset ones fall through to env and defaults."""
    given = {
        "input_path": getattr(args, "input", None),
        "output_dir": getattr(args, "output", None),
        "top_products": getattr(args, "top", None),
    }
    return {name: value for name, value in given.items() if value is not None}


def emit(args: argparse.Namespace, document: Mapping[str, object], text: str) -> None:
    sys.stdout.write((json.dumps(document) if args.json else text) + "\n")


def command_run(args: argparse.Namespace, settings: Settings) -> int:
    result = run_pipeline(settings.input_path, settings.output_dir, top=settings.top_products)
    outputs = {name: str(path) for name, path in result.outputs.items()}
    document = {
        "rows": {
            "read": result.rows_read,
            "clean": result.rows_clean,
            "rejected": result.rows_rejected,
            "duplicates": result.duplicates,
        },
        "outputs": outputs,
    }
    text = (
        f"Read {result.rows_read} rows from {settings.input_path}: {result.rows_clean} clean, "
        f"{result.rows_rejected} rejected, {result.duplicates} dropped as duplicates.\n"
        f"Wrote {len(outputs)} files to {settings.output_dir}."
    )
    emit(args, document, text)
    return 0


def command_compare(args: argparse.Namespace, _settings: Settings) -> int:
    problems = compare_outputs(args.actual, args.expected)
    if problems:
        raise PipelineError(
            ErrorCode.MISMATCH,
            "outputs differ from the expected files:\n" + "\n".join(problems),
            "Fix the transform, or update the expected CSV when the change is intended.",
        )
    emit(args, {"matched": True}, f"{args.actual} matches {args.expected}.")
    return 0


def render_error(error: PipelineError, *, as_json: bool) -> None:
    if as_json:
        document = {
            "error": {"code": error.code, "message": error.message, "suggestion": error.suggestion}
        }
        sys.stderr.write(json.dumps(document) + "\n")
    else:
        sys.stderr.write(f"{error.code}: {error.message}\nSuggestion: {error.suggestion}\n")


def run(argv: Sequence[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args_list
    configure_logging(level="warning", fmt="json" if as_json else "console")
    try:
        args = build_parser().parse_args(args_list)
        settings = load_settings(**flags(args))
        configure_logging(level=settings.log_level, fmt=settings.log_format)
        handler = command_run if args.command == "run" else command_compare
        return handler(args, settings)
    except SystemExit as exit_:  # --help and --version print, then exit 0.
        return exit_.code if isinstance(exit_.code, int) else 0
    except PipelineError as error:
        render_error(error, as_json=as_json)
        return error.exit_code
    except Exception as error:  # Every other failure leaves through the error table too.
        structlog.get_logger().debug("unexpected error", exc_info=error)
        failure = PipelineError(
            ErrorCode.INTERNAL,
            "unexpected error",
            f"Run again with {ENV_PREFIX}LOG_LEVEL=debug to log the details.",
        )
        render_error(failure, as_json=as_json)
        return failure.exit_code


def main() -> None:
    sys.exit(run())
