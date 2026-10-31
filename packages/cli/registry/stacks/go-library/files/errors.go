package libname

import (
	"errors"
	"strconv"
)

// The kinds of failure. Test for them with [errors.Is]; the error itself is a
// [*ParseError] or, from [New], an error wrapping [ErrInvalidOption].
var (
	// ErrSyntax means the text isn't a duration in this notation.
	ErrSyntax = errors.New("invalid syntax")
	// ErrRange means the text is well formed but longer than the parser's
	// maximum or than a [time.Duration] holds.
	ErrRange = errors.New("out of range")
	// ErrInvalidOption means an option passed to [New] can't apply.
	ErrInvalidOption = errors.New("invalid option")
)

// ParseError describes a failed [Parse]: the input, the byte where reading
// failed, what was wrong there and the kind of failure.
type ParseError struct {
	Input  string // the text that was parsed
	Offset int    // byte offset of the part that failed
	Reason string // what was wrong, for people
	Err    error  // ErrSyntax or ErrRange
}

// Error returns a message naming the input, the offset and the reason.
func (e *ParseError) Error() string {
	return "libname: parse " + strconv.Quote(e.Input) + ": " + e.Err.Error() +
		" at byte " + strconv.Itoa(e.Offset) + ": " + e.Reason
}

// Unwrap returns [ErrSyntax] or [ErrRange], so [errors.Is] reports the kind.
func (e *ParseError) Unwrap() error { return e.Err }
