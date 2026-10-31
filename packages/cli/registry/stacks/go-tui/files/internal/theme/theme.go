// Package theme holds every Lip Gloss style the UI uses. Views take styles
// from here and never build colors inline. NO_COLOR is honored by Bubble
// Tea's renderer, which downsamples whatever these styles emit.
package theme

import (
	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/list"
	"charm.land/lipgloss/v2"
)

type Theme struct {
	Dark   bool
	Title  lipgloss.Style
	Label  lipgloss.Style
	Muted  lipgloss.Style
	Error  lipgloss.Style
	Frame  lipgloss.Style
	List   list.Styles
	Item   list.DefaultItemStyles
	Help   help.Styles
	status map[string]lipgloss.Style
}

// New builds the styles for a dark or light terminal background.
func New(dark bool) Theme {
	pick := lipgloss.LightDark(dark)
	accent := pick(lipgloss.Color("#5A56E0"), lipgloss.Color("#7D79F6"))
	muted := pick(lipgloss.Color("#6B6B6B"), lipgloss.Color("#9A9A9A"))
	return Theme{
		Dark:  dark,
		Title: lipgloss.NewStyle().Bold(true).Foreground(accent),
		Label: lipgloss.NewStyle().Foreground(muted).Width(8),
		Muted: lipgloss.NewStyle().Foreground(muted),
		Error: lipgloss.NewStyle().Bold(true).Foreground(pick(lipgloss.Color("#C0392B"), lipgloss.Color("#FF6B6B"))),
		Frame: lipgloss.NewStyle().Padding(1, 2),
		List:  list.DefaultStyles(dark),
		Item:  list.NewDefaultItemStyles(dark),
		Help:  help.DefaultStyles(dark),
		status: map[string]lipgloss.Style{
			"todo":  lipgloss.NewStyle().Foreground(muted),
			"doing": lipgloss.NewStyle().Foreground(pick(lipgloss.Color("#B7791F"), lipgloss.Color("#F6C177"))),
			"done":  lipgloss.NewStyle().Foreground(pick(lipgloss.Color("#2F855A"), lipgloss.Color("#9CCFD8"))),
		},
	}
}

// Status styles a task status; unknown values render unstyled.
func (t Theme) Status(status string) string {
	style, ok := t.status[status]
	if !ok {
		return status
	}
	return style.Render(status)
}
