// Package views holds the templ components and the view models they render.
// Components take these plain types only: they never import a domain package or
// call a store, so handlers decide what a page shows.
package views

import "time"

// HTMXConfig is the htmx-config meta tag the layout renders. htmx doesn't swap
// 4xx or 5xx responses by default. 422 swaps so a form comes back with its
// errors; every other error swaps too, because the server retargets it to the
// AlertID region, and still counts as an error (htmx:responseError fires).
// allowEval and the indicator styles are off so the default-src 'self' content
// security policy holds.
const HTMXConfig = `{"responseHandling":[` +
	`{"code":"204","swap":false},` +
	`{"code":"[23]..","swap":true},` +
	`{"code":"422","swap":true},` +
	`{"code":"[45]..","swap":true,"error":true},` +
	`{"code":"...","swap":false}],` +
	`"allowEval":false,"includeIndicatorStyles":false}`

// FormID is the note form's element id; a 422 response retargets to it.
const FormID = "note-form"

// ListID is the note list's element id; the form appends new notes to it.
const ListID = "notes"

// AlertID is the layout's role="alert" region. A failed htmx request (other
// than a 422 form) retargets its ErrorAlert here.
const AlertID = "alert"

type Note struct {
	ID        string
	Title     string
	Body      string
	CreatedAt time.Time
}

// Form is the note form's values and the message for each invalid field.
type Form struct {
	Title  string
	Body   string
	Errors map[string]string
}

type ErrorPage struct {
	Status    int
	Title     string
	Message   string
	RequestID string
}
