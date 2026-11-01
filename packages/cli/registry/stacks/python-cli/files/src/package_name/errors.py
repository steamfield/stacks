"""The one error type commands raise, and the table mapping its codes to exit statuses."""

from enum import StrEnum


class ErrorCode(StrEnum):
    CONFIG = "CONFIG"
    INVALID_INPUT = "INVALID_INPUT"
    IO = "IO"
    INTERNAL = "INTERNAL"
    INTERRUPTED = "INTERRUPTED"


# One status per code, so a caller can tell a bad config from a crash. A new code takes the next
# free number; keep these.
EXIT_CODES: dict[ErrorCode, int] = {
    ErrorCode.INTERNAL: 1,
    ErrorCode.INVALID_INPUT: 2,
    ErrorCode.CONFIG: 3,
    ErrorCode.IO: 4,
    ErrorCode.INTERRUPTED: 130,
}


class CliError(Exception):
    """A failure with a safe message and a suggestion the user can act on."""

    def __init__(self, code: ErrorCode, message: str, suggestion: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.suggestion = suggestion

    @property
    def exit_code(self) -> int:
        return EXIT_CODES[self.code]


def internal_error() -> CliError:
    return CliError(
        ErrorCode.INTERNAL,
        "unexpected error",
        "Retry with --verbose to log the details, and report it if it persists.",
    )
