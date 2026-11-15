# Frontend test support

Start with [render-with-providers.tsx](render-with-providers.tsx), which mounts the
real router and providers with a controllable mock transport. Route tests beside
[../src/app/routes/main/route.tsx](../src/app/routes/main/route.tsx) use it to push
ticks and inspect failures. [setup.ts](setup.ts) installs DOM assertions and cleans up
rendered trees after each Vitest test.

[e2e/window.spec.ts](e2e/window.spec.ts) drives the browser app through Playwright,
checking metadata, live ticks and failed commands on the same mock transport.
Rust tests stay with their crates; these browser tests exercise the frontend.
