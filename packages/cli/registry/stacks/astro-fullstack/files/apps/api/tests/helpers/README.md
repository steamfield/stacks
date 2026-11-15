# HTTP test harness

Start with [targets.ts](targets.ts) for one request interface over Node and web
transports. [server.ts](server.ts) builds the application with captured logs,
configurable static files and body limits, and [failures.ts](failures.ts) adds
test-only error routes. Test finalizers close listeners and dispose web handlers.

[envelope.ts](envelope.ts) checks responses against the shared contract's safe error
table. [temp.ts](temp.ts) creates directories removed after each test.
Vitest loads [setup.ts](setup.ts) before application imports to remove credential-like
environment variables.
