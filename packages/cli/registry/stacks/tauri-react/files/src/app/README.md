# React window

Start with [providers.tsx](providers.tsx), which gives each tree a transport, query
client and tick store. It subscribes to ticks, reconnects ended streams and detaches
listeners on unmount. [router.tsx](router.tsx) selects a memory route by window label
and supplies a visible route-error view.

[routes/main/route.tsx](routes/main/route.tsx) renders metadata and live ticks through
those providers. Its separate store subscribers limit rerenders.
[route.test.tsx](routes/main/route.test.tsx) checks the real tree with a controllable
mock transport, including errors and subscription cleanup.
