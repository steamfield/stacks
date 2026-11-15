# HTTP test harness

Start with [targets.ts](targets.ts), the common request interface for Node and web
transports. [server.ts](server.ts) builds the real app with captured logs and
[failure routes](failures.ts); those routes exercise error middleware without adding
test switches to production code. Listener scopes and web handlers close after each test.

[envelope.ts](envelope.ts) checks public errors against the application's table.
[temp.ts](temp.ts) creates directories that tests clean up automatically.
Vitest loads [setup.ts](setup.ts) before application imports to remove credential-like
environment variables.
