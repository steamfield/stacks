package errors

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestErrorPreservesCause(t *testing.T) {
	cause := errors.New("connection refused")
	failure := Wrap(Unavailable, "store unavailable", cause)
	assert.ErrorIs(t, failure, cause)
	assert.Equal(t, "store unavailable: connection refused", failure.Error())
	plain := New(BadInput, "title is required")
	assert.Equal(t, "title is required", plain.Error())
	assert.Nil(t, plain.Unwrap())
}
