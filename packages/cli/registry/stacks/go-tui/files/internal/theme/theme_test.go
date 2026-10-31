package theme

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBackgroundChangesColors(t *testing.T) {
	dark, light := New(true), New(false)
	assert.True(t, dark.Dark)
	assert.False(t, light.Dark)
	assert.NotEqual(t, dark.Title.Render("x"), light.Title.Render("x"))
}

func TestStatus(t *testing.T) {
	th := New(true)
	for _, status := range []string{"todo", "doing", "done"} {
		assert.Contains(t, th.Status(status), status)
		assert.NotEqual(t, status, th.Status(status), "known statuses are styled")
	}
	assert.Equal(t, "later", th.Status("later"))
}
