package errors

const (
	// Invalid carries field errors; the form is re-rendered with them.
	Invalid          = "Invalid"
	BadInput         = "BadInput"
	Forbidden        = "Forbidden"
	NotFound         = "NotFound"
	MethodNotAllowed = "MethodNotAllowed"
	PayloadTooLarge  = "PayloadTooLarge"
	Internal         = "Internal"
	Unavailable      = "Unavailable"
)

type Error struct {
	Code, Message string
	// Fields maps a form field name to the message shown beside it (Invalid only).
	Fields map[string]string
	Cause  error
}

func New(code, message string) *Error { return &Error{Code: code, Message: message} }

func Wrap(code, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Cause: cause}
}

// Validation reports user input that failed validation, one message per field.
func Validation(fields map[string]string) *Error {
	return &Error{Code: Invalid, Message: "invalid input", Fields: fields}
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return e.Message + ": " + e.Cause.Error()
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Cause }
