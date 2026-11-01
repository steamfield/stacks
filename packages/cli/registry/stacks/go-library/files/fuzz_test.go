package libname

import (
	"errors"
	"testing"
	"time"
)

// FuzzParse checks two properties on any input: Parse either succeeds or
// returns a *ParseError of a known kind, and whatever it accepts survives a
// Format and Parse round trip. make test runs the seeds; make fuzz explores.
func FuzzParse(f *testing.F) {
	for _, seed := range []string{"1w2d3h4m5s6ms", "90m", "-1h30m", "0s", "", "1y", "1h 30m", "99999999999999999999s"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, s string) {
		d, err := Parse(s)
		if err != nil {
			var perr *ParseError
			if !errors.As(err, &perr) {
				t.Fatalf("Parse(%q) error %#v is not a *ParseError", s, err)
			}
			if !errors.Is(err, ErrSyntax) && !errors.Is(err, ErrRange) {
				t.Fatalf("Parse(%q) error %v wraps neither ErrSyntax nor ErrRange", s, err)
			}
			if perr.Offset < 0 || perr.Offset > len(s) {
				t.Fatalf("Parse(%q) offset %d is outside the input", s, perr.Offset)
			}
			return
		}
		if d%time.Millisecond != 0 {
			t.Fatalf("Parse(%q) = %d, not a whole number of milliseconds", s, d)
		}
		again, err := Parse(Format(d))
		if err != nil || again != d {
			t.Fatalf("Parse(Format(%v)) = %v, %v; want %v", d, again, err, d)
		}
	})
}
