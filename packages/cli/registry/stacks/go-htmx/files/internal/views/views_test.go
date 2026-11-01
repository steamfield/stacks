package views

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/a-h/templ"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func render(t *testing.T, component templ.Component) *goquery.Document {
	t.Helper()
	var out bytes.Buffer
	require.NoError(t, component.Render(t.Context(), &out))
	doc, err := goquery.NewDocumentFromReader(&out)
	require.NoError(t, err)
	return doc
}

var created = time.Date(2026, 1, 2, 15, 4, 0, 0, time.UTC)

func TestLayoutLoadsHTMXWithItsConfig(t *testing.T) {
	doc := render(t, NotesPage(nil, Form{}))
	assert.Equal(t, "Notes", doc.Find("title").Text())
	assert.Equal(t, "en", doc.Find("html").AttrOr("lang", ""))
	assert.Equal(t, 1, doc.Find(`script[src="/static/vendor/htmx.min.js"][defer]`).Length())
	assert.Equal(t, 1, doc.Find(`link[rel="stylesheet"][href="/static/app.css"]`).Length())
	content, ok := doc.Find(`meta[name="htmx-config"]`).Attr("content")
	require.True(t, ok)
	var config struct {
		ResponseHandling []struct {
			Code  string `json:"code"`
			Swap  bool   `json:"swap"`
			Error bool   `json:"error"`
		} `json:"responseHandling"`
		AllowEval bool `json:"allowEval"`
	}
	require.NoError(t, json.Unmarshal([]byte(content), &config))
	assert.False(t, config.AllowEval)
	// htmx uses the first rule that matches, so 422 must come before [45]..
	position := map[string]int{}
	swaps := map[string]bool{}
	for i, rule := range config.ResponseHandling {
		position[rule.Code] = i
		swaps[rule.Code] = rule.Swap
	}
	require.Contains(t, position, "422")
	require.Contains(t, position, "[45]..")
	assert.Less(t, position["422"], position["[45].."])
	assert.True(t, swaps["422"], "422 responses swap")
	assert.False(t, swaps["[45].."], "other errors don't swap")
}

func TestNotesPageListsNotesNewestFirst(t *testing.T) {
	notes := []Note{
		{ID: "b", Title: "Second", Body: "with a body", CreatedAt: created},
		{ID: "a", Title: "First", CreatedAt: created},
	}
	doc := render(t, NotesPage(notes, Form{}))
	items := doc.Find("ul#notes > li")
	require.Equal(t, 2, items.Length())
	assert.Equal(t, "note-b", items.First().AttrOr("id", ""))
	assert.Equal(t, "Second", items.First().Find("h2").Text())
	assert.Equal(t, "with a body", items.First().Find("p").Text())
	assert.Equal(t, 0, items.Last().Find("p").Length(), "an empty body renders no paragraph")
	assert.Equal(t, "2026-01-02T15:04:00Z", items.First().Find("time").AttrOr("datetime", ""))
}

func TestNoteFormWorksWithAndWithoutHTMX(t *testing.T) {
	form := render(t, NoteForm(Form{}, false)).Find("form#note-form")
	require.Equal(t, 1, form.Length())
	assert.Equal(t, "/notes", form.AttrOr("action", ""))
	assert.Equal(t, "post", form.AttrOr("method", ""))
	assert.Equal(t, "/notes", form.AttrOr("hx-post", ""))
	assert.Equal(t, "#notes", form.AttrOr("hx-target", ""))
	assert.Equal(t, "afterbegin", form.AttrOr("hx-swap", ""))
	_, oob := form.Attr("hx-swap-oob")
	assert.False(t, oob)
	assert.Equal(t, 0, form.Find("[aria-invalid], .field-error").Length())
}

func TestNoteFormShowsFieldErrorsAndKeepsValues(t *testing.T) {
	form := render(t, NoteForm(Form{
		Title:  "",
		Body:   "kept <b>as text</b>",
		Errors: map[string]string{"title": "Enter a title."},
	}, false)).Find("form")
	title := form.Find("input#title")
	assert.Equal(t, "true", title.AttrOr("aria-invalid", ""))
	assert.Equal(t, "title-error", title.AttrOr("aria-describedby", ""))
	assert.Equal(t, "Enter a title.", form.Find("#title-error").Text())
	body := form.Find("textarea#body")
	assert.Equal(t, "kept <b>as text</b>", body.Text())
	_, invalid := body.Attr("aria-invalid")
	assert.False(t, invalid)
	assert.Equal(t, 0, form.Find("b").Length(), "values are escaped")
}

func TestNoteCreatedSwapsTheFormOutOfBand(t *testing.T) {
	doc := render(t, NoteCreated(Note{ID: "x", Title: "<script>alert(1)</script>", CreatedAt: created}))
	item := doc.Find("li#note-x")
	require.Equal(t, 1, item.Length())
	assert.Equal(t, "<script>alert(1)</script>", item.Find("h2").Text())
	assert.Equal(t, 0, doc.Find("script").Length(), "titles are escaped")
	form := doc.Find("form#note-form")
	assert.Equal(t, "true", form.AttrOr("hx-swap-oob", ""))
	assert.Empty(t, form.Find("input#title").AttrOr("value", ""))
	assert.Equal(t, 0, doc.Find("html head title").Length(), "a fragment has no layout")
}

func TestErrorPage(t *testing.T) {
	doc := render(t, Error(ErrorPage{Status: 404, Title: "Page not found", Message: "Check the address.", RequestID: "req-1"}))
	assert.Equal(t, "Page not found", doc.Find("title").Text())
	assert.Equal(t, "Page not found", doc.Find("h1").Text())
	assert.Equal(t, "req-1", doc.Find(".request-id code").Text())
	assert.Equal(t, "/", doc.Find(`a[href="/"]`).AttrOr("href", ""))
	without := render(t, Error(ErrorPage{Status: 500, Title: "Something went wrong", Message: "Try again."}))
	assert.Equal(t, 0, without.Find(".request-id").Length())
}
