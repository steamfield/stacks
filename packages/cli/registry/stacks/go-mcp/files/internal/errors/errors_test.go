package errors

import (
	"fmt"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTable(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		exit    int
		message string
		fault   bool
	}{
		{name: "invalid input", err: New(InvalidInput, "unknown unit"), exit: 2, message: "unknown unit"},
		{name: "config", err: New(Config, "bad level"), exit: 2, message: "bad level"},
		{name: "internal keeps its cause private", err: Wrap(Internal, "read table", io.ErrUnexpectedEOF), exit: 1, message: InternalMessage, fault: true},
		{name: "wrapped twice", err: fmt.Errorf("convert: %w", New(InvalidInput, "kinds differ")), exit: 2, message: "kinds differ"},
		{name: "unknown code", err: New("SOMETHING", "secret detail"), exit: 1, message: InternalMessage, fault: true},
		{name: "plain error", err: io.EOF, exit: 1, message: InternalMessage, fault: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.exit, ExitCode(tt.err))
			message, fault := Public(tt.err)
			assert.Equal(t, tt.message, message)
			assert.Equal(t, tt.fault, fault)
		})
	}
	assert.Equal(t, 0, ExitCode(nil))
}

func TestError(t *testing.T) {
	err := Wrap(Internal, "read table", io.EOF)
	assert.Equal(t, "read table: EOF", err.Error())
	assert.ErrorIs(t, err, io.EOF)
	assert.Equal(t, "plain", New(Config, "plain").Error())
}
