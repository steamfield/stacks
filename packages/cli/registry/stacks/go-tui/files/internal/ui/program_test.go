package ui

import (
	"bytes"
	"testing"
	"time"

	"github.com/charmbracelet/x/exp/teatest/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProgram runs the real Bubble Tea loop headless: Init's command loads
// the tasks, key presses move and open, q ends the program.
func TestProgram(t *testing.T) {
	tm := teatest.NewTestModel(t, New(sample, discard), teatest.WithInitialTermSize(width, height))
	// Keys sent before the tasks arrive would hit the loading screen.
	teatest.WaitFor(t, tm.Output(), func(out []byte) bool {
		return bytes.Contains(out, []byte("3 tasks"))
	}, teatest.WithDuration(5*time.Second))
	tm.Type("jj")
	tm.Send(press("enter")[0])
	tm.Type("q")
	final, ok := tm.FinalModel(t, teatest.WithFinalTimeout(5*time.Second)).(Model)
	require.True(t, ok)
	assert.Equal(t, detail, final.screen)
	assert.Equal(t, "T-3", final.open.ID)
	assert.NoError(t, final.Err())
}
