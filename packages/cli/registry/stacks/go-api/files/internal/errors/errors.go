package errors

const (
	BadInput             = "BadInput"
	NotFound             = "NotFound"
	MethodNotAllowed     = "MethodNotAllowed"
	PayloadTooLarge      = "PayloadTooLarge"
	UnsupportedMediaType = "UnsupportedMediaType"
	Internal             = "Internal"
	Unavailable          = "Unavailable"
)

type Error struct {
	Code, Message string
	Cause         error
}

func New(code, message string) *Error { return &Error{Code: code, Message: message} }

func Wrap(code, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Cause: cause}
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return e.Message + ": " + e.Cause.Error()
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Cause }
