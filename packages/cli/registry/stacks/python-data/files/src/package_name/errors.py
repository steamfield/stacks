"""The one error type the pipeline raises, and the table mapping its codes to exit statuses."""

from enum import StrEnum


class ErrorCode(StrEnum):
    USAGE = "USAGE"
    CONFIG = "CONFIG"
    INPUT = "INPUT"
    SCHEMA = "SCHEMA"
    OUTPUT = "OUTPUT"
    MISMATCH = "MISMATCH"
    INTERNAL = "INTERNAL"


EXIT_CODES: dict[ErrorCode, int] = {
    ErrorCode.INTERNAL: 1,
    ErrorCode.USAGE: 2,
    ErrorCode.CONFIG: 3,
    ErrorCode.INPUT: 4,
    ErrorCode.SCHEMA: 5,
    ErrorCode.OUTPUT: 6,
    ErrorCode.MISMATCH: 7,
}


class PipelineError(Exception):
    """A failure with a safe message and a suggestion the user can act on."""

    def __init__(self, code: ErrorCode, message: str, suggestion: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.suggestion = suggestion

    @property
    def exit_code(self) -> int:
        return EXIT_CODES[self.code]
