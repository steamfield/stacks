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
	plain := New(NotFound, "note not found")
	assert.Equal(t, "note not found", plain.Error())
	assert.Nil(t, plain.Unwrap())
}

func TestValidationCarriesFields(t *testing.T) {
	failure := Validation(map[string]string{"title": "Enter a title."})
	assert.Equal(t, Invalid, failure.Code)
	assert.Equal(t, "Enter a title.", failure.Fields["title"])
	assert.Equal(t, "invalid input", failure.Error())
}
