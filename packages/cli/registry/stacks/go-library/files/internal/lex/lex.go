// Package lex splits duration text into number-and-unit parts. It knows the
// grammar, not the units: the root package decides which units exist and what
// they are worth. Code outside this module can't import it.
package lex

import "math"

// Part is one number and the unit written after it, such as "90" and "m".
type Part struct {
	Value      int64
	Unit       string
	Offset     int // byte offset of the number
	UnitOffset int // byte offset of the unit
}

// Error is a grammar failure at Offset. Overflow is set when the text is well
// formed but a number is too large for an int64.
type Error struct {
	Offset   int
	Reason   string
	Overflow bool
}

// Split reads s as one or more parts, each a run of ASCII digits followed by a
// run of ASCII letters, with nothing between or around them.
func Split(s string) ([]Part, *Error) {
	if s == "" {
		return nil, &Error{Offset: 0, Reason: "empty duration"}
	}
	var parts []Part
	for i := 0; i < len(s); {
		part, next, err := split(s, i)
		if err != nil {
			return nil, err
		}
		parts = append(parts, part)
		i = next
	}
	return parts, nil
}

// split reads the part that starts at byte i and returns it with the offset
// after it.
func split(s string, i int) (Part, int, *Error) {
	part := Part{Offset: i}
	j := i
	for ; j < len(s) && isDigit(s[j]); j++ {
		digit := int64(s[j] - '0')
		if part.Value > (math.MaxInt64-digit)/10 {
			return Part{}, 0, &Error{Offset: i, Reason: "number too large", Overflow: true}
		}
		part.Value = part.Value*10 + digit
	}
	if j == i {
		return Part{}, 0, &Error{Offset: i, Reason: "expected a number"}
	}
	part.UnitOffset = j
	for j < len(s) && isLetter(s[j]) {
		j++
	}
	if j == part.UnitOffset {
		return Part{}, 0, &Error{Offset: j, Reason: "missing unit after number"}
	}
	part.Unit = s[part.UnitOffset:j]
	return part, j, nil
}

func isDigit(c byte) bool { return '0' <= c && c <= '9' }

func isLetter(c byte) bool { return 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' }
