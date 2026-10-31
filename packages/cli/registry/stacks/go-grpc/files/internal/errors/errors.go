// Package errors holds the domain error type. Domain code returns these;
// internal/rpc maps each code to a Connect/gRPC status in one table.
package errors

const (
	// BadInput is the caller's fault; Message is sent to the caller as written.
	BadInput = "BadInput"
	// NotFound is the caller's fault; Message is sent to the caller as written.
	NotFound = "NotFound"
	// Internal and Unavailable are the server's; callers get a fixed message
	// and the cause goes to the log.
	Internal    = "Internal"
	Unavailable = "Unavailable"
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
