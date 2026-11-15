# CLI source

Start with [bin.ts](bin.ts), which supplies Bun services, host metadata, streams
and signals. [runtime.ts](runtime.ts) composes application layers;
[main.ts](main.ts) owns each invocation's output, failures and command log.

[cli.ts](cli.ts) builds the command tree. Follow `commands/doctor.ts` into
`core/doctor.ts` for the thin-handler pattern: core code returns a diagnostic,
then the handler presents it through [services/](services/README.md).
[schemas/](schemas/README.md) holds result and package contracts.

[config.ts](config.ts) loads settings lazily, [errors.ts](errors.ts) owns safe
exit policies, and [logging.ts](logging.ts) formats and delivers records.
Unit tests sit beside pure contracts; `../tests/` exercises real invocations.

