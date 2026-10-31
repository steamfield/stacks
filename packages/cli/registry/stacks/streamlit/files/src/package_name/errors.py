"""The one error type the package raises, and the table of headings the page shows for each code."""

from enum import StrEnum


class ErrorCode(StrEnum):
    CONFIG = "CONFIG"
    DATA_MISSING = "DATA_MISSING"
    DATA_SCHEMA = "DATA_SCHEMA"


HEADINGS: dict[ErrorCode, str] = {
    ErrorCode.CONFIG: "Configuration error",
    ErrorCode.DATA_MISSING: "Data not found",
    ErrorCode.DATA_SCHEMA: "Data doesn't match the expected columns",
}


class AppError(Exception):
    """A failure with a safe message and a suggestion the viewer can act on."""

    def __init__(self, code: ErrorCode, message: str, suggestion: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.suggestion = suggestion

    @property
    def heading(self) -> str:
        return HEADINGS[self.code]
