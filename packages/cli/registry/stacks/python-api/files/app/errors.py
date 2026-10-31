from typing import NamedTuple


class ErrorRow(NamedTuple):
    status: int
    message: str
    retryable: bool = False


ERRORS = {
    "BadInput": ErrorRow(400, "Invalid request."),
    "NotFound": ErrorRow(404, "Resource not found."),
    "MethodNotAllowed": ErrorRow(405, "Method not allowed."),
    "Conflict": ErrorRow(409, "Resource conflict."),
    "Unauthorized": ErrorRow(401, "Authentication required."),
    "Forbidden": ErrorRow(403, "Access denied."),
    "UnsupportedMediaType": ErrorRow(415, "Expected a JSON body."),
    "Internal": ErrorRow(500, "Internal server error."),
    "Unavailable": ErrorRow(503, "Service unavailable.", True),
}


class AppError(Exception):
    def __init__(self, tag: str) -> None:
        self.tag = tag
        super().__init__(tag)


class NotFound(AppError):
    def __init__(self) -> None:
        super().__init__("NotFound")


class ServiceUnavailable(AppError):
    def __init__(self) -> None:
        super().__init__("Unavailable")
