// Package static embeds the files served under /static/, so the binary carries
// its own assets. vendor/htmx.min.js is downloaded by `make htmx` and committed;
// the build fails until it exists.
package static

import "embed"

//go:embed app.css vendor/htmx.min.js
var FS embed.FS
