from typing import NamedTuple


class ErrorRow(NamedTuple):
    status: int
    message: str
    retryable: bool = False


ERRORS = {
    "VALIDATION_FAILED": ErrorRow(422, "Invalid request."),
    "NOT_FOUND": ErrorRow(404, "Resource not found."),
    "METHOD_NOT_ALLOWED": ErrorRow(405, "Method not allowed."),
    "CONFLICT": ErrorRow(409, "Resource conflict."),
    "UNAUTHORIZED": ErrorRow(401, "Authentication required."),
    "FORBIDDEN": ErrorRow(403, "Access denied."),
    "UNSUPPORTED_MEDIA_TYPE": ErrorRow(415, "Expected a JSON body."),
    "INTERNAL_ERROR": ErrorRow(500, "Internal server error."),
    "UNAVAILABLE": ErrorRow(503, "Service unavailable.", True),
}


class AppError(Exception):
    def __init__(self, tag: str) -> None:
        self.tag = tag
        super().__init__(tag)


class NotFound(AppError):
    def __init__(self) -> None:
        super().__init__("NOT_FOUND")


class ServiceUnavailable(AppError):
    def __init__(self) -> None:
        super().__init__("UNAVAILABLE")
