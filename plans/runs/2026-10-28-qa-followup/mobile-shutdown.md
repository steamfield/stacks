# Signal status during mobile cleanup

Status: fixed and regression-tested, 2026-10-28.

One full CLI suite observed exit 1 instead of 143 after SIGTERM. Isolated retries
did not reproduce that exact event. Inspection found a deterministic race in
`registry/stacks/mobile-expo/files/scripts/dev.ts`: the normal path sets its exit
code before awaiting cleanup, while a signal during cleanup updated only the
`interrupted` variable. The already chosen exit code survived.

The regression starts owned API/mobile processes and an API child that ignores
SIGTERM. An API failure starts bounded cleanup with exit 7; the test then sends
SIGTERM while that cleanup is active. The old handler exits 7, and the corrected
handler exits 143. Assigning `process.exitCode` in the signal handler makes that
signal authoritative even after the ordinary status was chosen.

The test reproduced the lost status before the fix. All ten lifecycle tests
passed with the fix. Removing the production line again failed the regression
with expected 143 versus actual 7; restoring it passed. All ten tests also passed
on the host that produced the original full-suite mismatch. The final merged-tree
gate is recorded in the closure note.

This demonstrates and fixes the cleanup race. The original uninstrumented exit-1
event cannot be attributed conclusively to it. Ownership and cleanup assertions
remain intact; tests signal only their own processes and preserve unrelated
listeners. Temporary fixture projects and owned processes were cleaned up.
