package lex

import (
	"reflect"
	"testing"
)

func TestSplit(t *testing.T) {
	tests := []struct {
		in   string
		want []Part
	}{
		{"90m", []Part{{Value: 90, Unit: "m", Offset: 0, UnitOffset: 2}}},
		{"1h30m", []Part{
			{Value: 1, Unit: "h", Offset: 0, UnitOffset: 1},
			{Value: 30, Unit: "m", Offset: 2, UnitOffset: 4},
		}},
		{"250ms", []Part{{Value: 250, Unit: "ms", Offset: 0, UnitOffset: 3}}},
		{"0s", []Part{{Value: 0, Unit: "s", Offset: 0, UnitOffset: 1}}},
		{"2xyz", []Part{{Value: 2, Unit: "xyz", Offset: 0, UnitOffset: 1}}},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := Split(tt.in)
			if err != nil {
				t.Fatalf("Split(%q) error: %+v", tt.in, err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Split(%q) = %+v, want %+v", tt.in, got, tt.want)
			}
		})
	}
}

func TestSplitErrors(t *testing.T) {
	tests := []struct {
		in   string
		want Error
	}{
		{"", Error{Offset: 0, Reason: "empty duration"}},
		{"h", Error{Offset: 0, Reason: "expected a number"}},
		{"10", Error{Offset: 2, Reason: "missing unit after number"}},
		{"1h 30m", Error{Offset: 2, Reason: "expected a number"}},
		{"1h30", Error{Offset: 4, Reason: "missing unit after number"}},
		{"1.5h", Error{Offset: 1, Reason: "missing unit after number"}},
		{"99999999999999999999s", Error{Offset: 0, Reason: "number too large", Overflow: true}},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			parts, err := Split(tt.in)
			if err == nil {
				t.Fatalf("Split(%q) = %+v, want error", tt.in, parts)
			}
			if *err != tt.want {
				t.Errorf("Split(%q) error = %+v, want %+v", tt.in, *err, tt.want)
			}
		})
	}
}
