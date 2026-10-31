package errors

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestErrors(t *testing.T) {
	cause := errors.New("permission denied")
	err := Wrap(IO, "read file", "Check permissions.", cause)
	assert.Equal(t, "read file: permission denied", err.Error())
	assert.ErrorIs(t, err, cause)
	assert.Equal(t, "Check permissions.", err.Suggestion)
	plain := New(Config, "invalid greeting", "Set greeting.")
	assert.Equal(t, "invalid greeting", plain.Error())
	assert.Nil(t, plain.Unwrap())
}

func TestExitCode(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{"success", nil, 0},
		{"usage", New(InvalidInput, "bad argument", "Read help."), 2},
		{"wrapped usage", fmt.Errorf("command: %w", New(InvalidInput, "bad argument", "Read help.")), 2},
		{"config", New(Config, "bad config", "Fix YAML."), 1},
		{"missing config", New(ConfigNotFound, "missing config", "Choose a file."), 1},
		{"not found", New(NotFound, "missing item", "Choose an item."), 1},
		{"io", New(IO, "write failed", "Check permissions."), 1},
		{"internal", New(Internal, "failed", "Retry."), 1},
		{"unstructured", errors.New("failed"), 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExitCode(tt.err))
			if tt.err != nil {
				require.Error(t, tt.err)
			}
		})
	}
}
