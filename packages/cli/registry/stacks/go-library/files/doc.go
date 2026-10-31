// Package libname reads and writes human durations with days and weeks, such
// as "1w2d" or "1h30m", which [time.ParseDuration] doesn't accept.
//
// [Parse] reads a duration with the default limits and [Format] writes one
// back in the same notation, so Format's output always parses. [New] returns
// a [Parser] with options, such as a shorter maximum with [WithMax].
//
// The units are w (7 days), d (24 hours), h, m, s and ms. A day is always 24
// hours: these are elapsed durations, not calendar arithmetic.
//
// Every error Parse returns is a [*ParseError] that wraps [ErrSyntax] or
// [ErrRange], so callers can test the kind with [errors.Is] and read the
// offset with [errors.As].
package libname
