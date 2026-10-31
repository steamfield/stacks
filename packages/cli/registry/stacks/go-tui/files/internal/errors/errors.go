package errors

import "errors"

const (
	Config       = "CONFIG"
	InvalidInput = "INVALID_INPUT"
	InvalidData  = "INVALID_DATA"
	IO           = "IO"
	Interrupted  = "INTERRUPTED"
	Internal     = "INTERNAL"
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

// ExitCode is the one mapping from error codes to process exit status.
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var failure *Error
	if !errors.As(err, &failure) {
		return 1
	}
	switch failure.Code {
	case InvalidInput:
		return 2
	case Interrupted:
		return 130
	default:
		return 1
	}
}
