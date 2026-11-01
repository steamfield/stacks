// Package errors holds the error type every package returns. Its table is the
// one mapping from a code to what the MCP client sees and to the exit status.
package errors

import "errors"

const (
	// InvalidInput is the caller's fault (a bad flag, or tool arguments the
	// schema can't catch). Message reaches the caller as written.
	InvalidInput = "INVALID_INPUT"
	// Config is a bad setting; Message names it and reaches the caller.
	Config = "CONFIG"
	// Internal is the server's fault. Callers get a fixed message; the cause
	// goes to the log.
	Internal = "INTERNAL"
)

// InternalMessage is all a client learns about a server fault.
const InternalMessage = "internal error; the server logged the details"

type row struct {
	exit   int
	public bool
}

// table is the one mapping from codes. A new code gets a row here and a case
// in TestTable.
var table = map[string]row{
	InvalidInput: {exit: 2, public: true},
	Config:       {exit: 2, public: true},
	Internal:     {exit: 1},
}

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

func lookup(err error) (*Error, row) {
	var failure *Error
	if errors.As(err, &failure) {
		if known, ok := table[failure.Code]; ok {
			return failure, known
		}
	}
	return nil, table[Internal]
}

// Public returns the message a client may see, and whether err is the
// server's fault (so the caller logs the cause).
func Public(err error) (message string, fault bool) {
	failure, known := lookup(err)
	if failure != nil && known.public {
		return failure.Message, false
	}
	return InternalMessage, true
}

// ExitCode is the process exit status for an error from startup or serving.
func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	_, known := lookup(err)
	return known.exit
}
