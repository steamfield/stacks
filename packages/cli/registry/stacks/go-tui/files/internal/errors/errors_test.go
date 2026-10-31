package errors

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestErrors(t *testing.T) {
	cause := errors.New("permission denied")
	err := Wrap(IO, "read tasks", "Check permissions.", cause)
	assert.Equal(t, "read tasks: permission denied", err.Error())
	assert.ErrorIs(t, err, cause)
	assert.Equal(t, "Check permissions.", err.Suggestion)
	plain := New(Config, "invalid log level", "Use info.")
	assert.Equal(t, "invalid log level", plain.Error())
	assert.Nil(t, plain.Unwrap())
}

func TestExitCode(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{"success", nil, 0},
		{"usage", New(InvalidInput, "bad flag", "Read help."), 2},
		{"wrapped usage", fmt.Errorf("parse: %w", New(InvalidInput, "bad flag", "Read help.")), 2},
		{"interrupted", New(Interrupted, "interrupted", "Run it again."), 130},
		{"config", New(Config, "bad setting", "Fix it."), 1},
		{"data", New(InvalidData, "bad task", "Fix the file."), 1},
		{"io", New(IO, "write failed", "Check permissions."), 1},
		{"internal", New(Internal, "failed", "Retry."), 1},
		{"unstructured", errors.New("failed"), 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExitCode(tt.err))
		})
	}
}
