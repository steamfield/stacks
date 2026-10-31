"""The command tree and the one place that turns failures into exit statuses."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from importlib.metadata import version as package_version
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any

import structlog
import typer

from package_name.config import APP_NAME, Settings, load_settings
from package_name.errors import EXIT_CODES, CliError, ErrorCode, internal_error
from package_name.log import configure_logging
from package_name.output import OutputOptions, render, render_error

if TYPE_CHECKING:
    from collections.abc import Sequence

app = typer.Typer(
    name=APP_NAME,
    help="A command-line tool with typed configuration.",
    add_completion=False,
    pretty_exceptions_enable=False,
)
config_app = typer.Typer(help="Inspect the effective configuration.", no_args_is_help=False)
app.add_typer(config_app, name="config")


@dataclass
class Invocation:
    """Root options, kept until a command loads settings with them."""

    config_file: Path | None = None
    flags: dict[str, Any] = field(default_factory=dict)


def output_options(settings: Settings) -> OutputOptions:
    return OutputOptions(json=settings.output == "json", color=settings.color)


def start(ctx: typer.Context) -> Settings:
    """Load settings and configure logging once; every command begins here."""
    invocation: Invocation = ctx.ensure_object(Invocation)
    settings = load_settings(invocation.config_file, invocation.flags)
    configure_logging(verbose=settings.verbose, json=settings.output == "json")
    return settings


@app.callback(invoke_without_command=True)
def root(
    ctx: typer.Context,
    *,
    config_file: Annotated[
        Path | None,
        typer.Option("--config", help="TOML config file to read instead of the default one."),
    ] = None,
    json_output: Annotated[
        bool | None, typer.Option("--json/--no-json", help="Write JSON output.")
    ] = None,
    verbose: Annotated[bool, typer.Option("--verbose", help="Log debug details.")] = False,
    no_color: Annotated[bool, typer.Option("--no-color", help="Disable color.")] = False,
    show_version: Annotated[
        bool, typer.Option("--version", help="Show the version and exit.")
    ] = False,
) -> None:
    flags: dict[str, Any] = {}
    if json_output is not None:
        flags["output"] = "json" if json_output else "text"
    if verbose:
        flags["verbose"] = True
    if no_color:
        flags["color"] = False
    ctx.obj = Invocation(config_file=config_file, flags=flags)
    if show_version:
        current = package_version(APP_NAME)
        render(OutputOptions(json=bool(json_output)), {"version": current}, f"{APP_NAME} {current}")
        raise typer.Exit
    if ctx.invoked_subcommand is None:
        sys.stdout.write(ctx.get_help() + "\n")


@config_app.command("show")
def config_show(ctx: typer.Context) -> None:
    """Print the effective configuration."""
    settings = start(ctx)
    structlog.get_logger().debug("config loaded", output=settings.output)
    values = settings.model_dump()
    human = "\n".join(f"{key}: {json.dumps(value)}" for key, value in values.items())
    render(output_options(settings), values, human)


def explicit_json(args: Sequence[str]) -> bool:
    """Errors can happen before settings load, so they follow the explicit flag only."""
    options = args[: args.index("--")] if "--" in args else args
    return "--json" in options and "--no-json" not in options


def run(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    options = OutputOptions(json=explicit_json(args), color="--no-color" not in args)
    # Until a command loads settings, log by the explicit flags so nothing reaches stdout.
    configure_logging(verbose="--verbose" in args, json=options.json)
    try:
        result = app(args=args, prog_name=APP_NAME, standalone_mode=False)
    except Exception as error:  # Every failure leaves through the error table.
        failure = as_cli_error(error)
        render_error(options, failure)
        return failure.exit_code
    # Typer returns an exit status for --help and typer.Exit, and the command's value otherwise.
    return result if isinstance(result, int) else 0


def as_cli_error(error: Exception) -> CliError:
    if isinstance(error, CliError):
        return error
    if isinstance(error, typer.TyperException):
        usage = error.exit_code == EXIT_CODES[ErrorCode.INVALID_INPUT]
        code = ErrorCode.INVALID_INPUT if usage else ErrorCode.INTERNAL
        return CliError(code, error.format_message(), f"Run {APP_NAME} --help for usage.")
    if isinstance(error, typer.Abort):
        # Typer raises Abort when input closes at a prompt; Ctrl+C already returned 130.
        return CliError(ErrorCode.INTERRUPTED, "aborted", "Run the command again.")
    structlog.get_logger().debug("unexpected error", exc_info=error)
    return internal_error()


def main() -> None:
    sys.exit(run())
