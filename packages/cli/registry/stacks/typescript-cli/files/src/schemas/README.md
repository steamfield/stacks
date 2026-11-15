# CLI data contracts

Start with [doctor.ts](doctor.ts), the result schema for the diagnostic built in
`../core/doctor.ts`. Invocation tests decode the JSON result with this same schema
to check the contract callers receive.

[package.ts](package.ts) defines the package name and optional version read by
the process entry and build script. Both decode raw metadata before using it.

These modules depend on Effect Schema and describe data without reading files,
environment variables or process streams. The boundary code supplies those values.

