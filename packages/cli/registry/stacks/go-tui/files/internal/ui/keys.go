package ui

import "charm.land/bubbles/v2/key"

// keyMap holds every binding the UI handles itself. A new binding goes here
// and into the help of the screen that uses it. The list keeps its own
// bindings for moving and filtering.
type keyMap struct {
	Open      key.Binding
	Back      key.Binding
	Quit      key.Binding
	ForceQuit key.Binding
}

func newKeyMap() keyMap {
	return keyMap{
		Open: key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "open")),
		Back: key.NewBinding(key.WithKeys("esc", "backspace"), key.WithHelp("esc", "back")),
		Quit: key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit")),
		// Works on every screen, including while typing a filter.
		ForceQuit: key.NewBinding(key.WithKeys("ctrl+c")),
	}
}
