package errors

import "errors"

const (
	Config         = "CONFIG"
	ConfigNotFound = "CONFIG_NOT_FOUND"
	InvalidInput   = "INVALID_INPUT"
	NotFound       = "NOT_FOUND"
	IO             = "IO"
	Internal       = "INTERNAL"
)

type Error struct {
	Code, Message, Suggestion string
	Cause                     error
}

func New(code, message, suggestion string) *Error {
	return &Error{Code: code, Message: message, Suggestion: suggestion}
}

func Wrap(code, message, suggestion string, cause error) *Error {
	return &Error{Code: code, Message: message, Suggestion: suggestion, Cause: cause}
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return e.Message + ": " + e.Cause.Error()
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Cause }

func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var failure *Error
	if errors.As(err, &failure) && failure.Code == InvalidInput {
		return 2
	}
	return 1
}
