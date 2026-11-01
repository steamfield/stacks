package libname

import (
	"errors"
	"math"
	"testing"
	"time"
)

func TestParse(t *testing.T) {
	tests := []struct {
		in   string
		want time.Duration
	}{
		{"0s", 0},
		{"250ms", 250 * time.Millisecond},
		{"90m", 90 * time.Minute},
		{"1h30m", 90 * time.Minute},
		{"2d", 48 * time.Hour},
		{"1w2d3h4m5s6ms", Week + 2*Day + 3*time.Hour + 4*time.Minute + 5*time.Second + 6*time.Millisecond},
		{"30m30m", time.Hour},
		{"-1h30m", -90 * time.Minute},
		{"15250w", 15250 * Week},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := Parse(tt.in)
			if err != nil {
				t.Fatalf("Parse(%q) error: %v", tt.in, err)
			}
			if got != tt.want {
				t.Errorf("Parse(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestParseErrors(t *testing.T) {
	tests := []struct {
		in     string
		kind   error
		offset int
		msg    string
	}{
		{"", ErrSyntax, 0, `libname: parse "": invalid syntax at byte 0: empty duration`},
		{"-", ErrSyntax, 1, `libname: parse "-": invalid syntax at byte 1: empty duration`},
		{"1y", ErrSyntax, 1, `libname: parse "1y": invalid syntax at byte 1: unknown unit "y"; use w, d, h, m, s or ms`},
		{"1h 30m", ErrSyntax, 2, `libname: parse "1h 30m": invalid syntax at byte 2: expected a number`},
		{"-1H", ErrSyntax, 2, `libname: parse "-1H": invalid syntax at byte 2: unknown unit "H"; use w, d, h, m, s or ms`},
		{"15260w", ErrRange, 0, `libname: parse "15260w": out of range at byte 0: longer than the maximum, 15250w1d23h47m16s854ms`},
		{"1d99999999999999999999s", ErrRange, 2, `libname: parse "1d99999999999999999999s": out of range at byte 2: number too large`},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			_, err := Parse(tt.in)
			if !errors.Is(err, tt.kind) {
				t.Fatalf("Parse(%q) error = %v, want one wrapping %v", tt.in, err, tt.kind)
			}
			var perr *ParseError
			if !errors.As(err, &perr) {
				t.Fatalf("Parse(%q) error %T is not a *ParseError", tt.in, err)
			}
			if perr.Input != tt.in || perr.Offset != tt.offset {
				t.Errorf("ParseError{Input: %q, Offset: %d}, want {%q, %d}", perr.Input, perr.Offset, tt.in, tt.offset)
			}
			if err.Error() != tt.msg {
				t.Errorf("message = %s\nwant      %s", err, tt.msg)
			}
		})
	}
}

func TestNew(t *testing.T) {
	p, err := New()
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}
	if p.Max() != MaxDuration {
		t.Errorf("default Max() = %v, want %v", p.Max(), MaxDuration)
	}

	p, err = New(WithMax(Day))
	if err != nil {
		t.Fatalf("New(WithMax(Day)) error: %v", err)
	}
	if got, err := p.Parse("-24h"); err != nil || got != -Day {
		t.Errorf("Parse at the maximum = %v, %v; want -24h0m0s, nil", got, err)
	}
	if _, err := p.Parse("1d1ms"); !errors.Is(err, ErrRange) {
		t.Errorf("Parse past the maximum: error = %v, want ErrRange", err)
	}

	for _, bad := range []time.Duration{0, -time.Second} {
		if _, err := New(WithMax(bad)); !errors.Is(err, ErrInvalidOption) {
			t.Errorf("New(WithMax(%v)) error = %v, want ErrInvalidOption", bad, err)
		}
	}
}

func TestFormat(t *testing.T) {
	tests := []struct {
		in   time.Duration
		want string
	}{
		{0, "0s"},
		{999 * time.Microsecond, "0s"},
		{-time.Microsecond, "0s"},
		{1500 * time.Millisecond, "1s500ms"},
		{36 * time.Hour, "1d12h"},
		{Week + time.Minute, "1w1m"},
		{-90 * time.Minute, "-1h30m"},
		{math.MinInt64, "-15250w1d23h47m16s854ms"},
	}
	for _, tt := range tests {
		if got := Format(tt.in); got != tt.want {
			t.Errorf("Format(%d) = %q, want %q", int64(tt.in), got, tt.want)
		}
	}
}
