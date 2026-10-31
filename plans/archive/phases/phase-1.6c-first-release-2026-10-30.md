# Phase 1.6c: First release

Status: EXECUTED 2026-10-27: `@steamfield/stacks` 0.1.0 published by hand from the packed
tarball (D34, which waives D20's gate). Not done: the gate run repeated from the packed
tarball; the release was checked by a manual QA pass over the installed package instead.
Earlier status: DRAFT 2026-10-26 (not agreed). Moved 2026-10-26 to the end of the plan (number
kept): with 0.2 and the npm reservation it is the final step before public release, after
the roadmap's feature gaps. It now depends on 0.2 directly, and if 1.6b ran from the
compiled binary it repeats at least one gate run from the packed tarball before
publishing. The Blocks list below is superseded by the roadmap's "Release: the final
step" section (3.0 and 4.0a no longer wait for it)

| Field | Value |
|---|---|
| Goal | With A2-A4 and D20 recorded in the README decisions log, a maintainer publishes to npm by hand the exact tarball 1.6b's gate ran, checked by file digest before and after, and `npx stacks@latest list --json` works on a clean machine with only Node. The MVP cutline in the roadmap is then true |
| Traces to | The README's first command, `npx stacks new`; D9's entry point "ask your agent to run stacks", which only works if the agent can `npx` it; success row "The agent finishes without help" (the gate this release rests on) |
| Depends on | 1.6b (the release tarball, its digest and the passing runs), 0.0 (the reserved name, D20, A2-A4) |
| Blocks | 2.0b, 3.0, 3.3a, 3.4c, 4.0a, 4.1e, 4.3, 5.0 |
| Decisions needed | A2, A3, A4 and D20 in the [README decisions log](../../README.md#decisions-log) before publishing (exit criterion, not a soft dependency): exit 5, the `details` envelope and the signal policy are permanent once agents depend on them. [Open question 20](../../risks-and-open-questions.md#open-questions-for-the-maintainers): a manual publish without provenance; if the answer is no, this sub-phase waits for 5.0 and publishes through its workflow instead. D12 and D22 (supported Node and platforms) define "clean machine" |
| Settles | That `stacks` is installable with `npx`; the first published version |

## Where this fits

1.6a and 1.6d wrote the content and 1.6b ran it, ending with one tarball file, its sha256 and the
commit it came from. This sub-phase changes nothing in that file: it records the
decisions the release makes permanent, publishes the file, and checks what npm serves.
The tag-driven release workflow and npm provenance are 5.0; this is the manual
precursor to it.

## Scope

In:

- Recording A2-A4 and D20 in the decisions log, and checking open question 20 is
  answered.
- Publishing the 1.6b tarball with `npm publish <tarball>`, by a maintainer.
- Digest checks before and after publishing.
- Checks from a clean machine against the published version.
- A git tag `v<version>` on the release commit, pushed by a maintainer. No workflow runs
  on it before 5.0.

Out:

- A release workflow, provenance, publishing from CI (5.0).
- Any change to the tarball's contents. A README typo found now waits for the next
  release, or goes back through 1.6b.
- Release notes beyond the package README and the HANDOFF entry.

## Design

### Before publishing

1. The decisions log in [plans/README.md](../../README.md#decisions-log) has entries for
   A2, A3, A4 and D20. If any is missing, stop: the maintainers decide, then continue.
   If a decision differs from what the code does, the code changes, which changes the
   tarball, which sends the release back through 1.6b.
2. Open question 20 is answered yes (or still the stated default and the maintainers
   confirm it here).
3. The tarball file exists at the path in 1.6b's last run note, and
   `shasum -a 256 <tarball>` equals the recorded digest. If the file is gone and 1.6b
   recorded packing as reproducible, repack from the recorded commit and require the same
   digest; otherwise the gate reruns.
4. `npm publish --dry-run <tarball>` lists the same files as `tar -tzf <tarball>` and the
   expected name and version.
5. `npm view stacks versions` doesn't contain the version.

### Publishing

A maintainer runs `npm publish <tarball>` with their npm login and 2FA, publishing to
the `latest` dist-tag. The agent prepares the commands and checks; it never holds the
npm credentials.

### After publishing

1. Digest: compute the sha512 integrity of the local tarball in npm's
   `sha512-<base64>` form and compare it with
   `npm view stacks@<version> dist.integrity`:

   ```sh
   echo "sha512-$(openssl dgst -sha512 -binary <tarball> | openssl base64 -A)"
   ```

   The two strings must be equal; that proves npm serves the gated file.
2. Clean machine: a macOS machine or a Linux container with only Node at the lowest
   version D12 allows, no Bun, an empty npm cache, and a fresh HOME:
   - `npx stacks@latest list --json` exits 0 and lists the three bundled stacks.
   - `npx stacks@latest new astro-blog <tmp> --sandbox --no-launch --json` writes
     `.stacks/BRIEF.md`, `.stacks/manifest.json` and `.gitignore`, and the
     brief's verify command is the `npx -y stacks@<version>` form (see roadmap,
     Contracts: Invocation string), which now resolves.
   - Repeat both on the `.node-version` Node.
   Record the results, platform and Node versions in the HANDOFF entry.
3. Tag the release commit `v<version>` and push the tag.

### Failure modes

| Case | What happens |
|---|---|
| A decision in step 1 isn't recorded | Stop before publishing |
| Local digest differs from 1.6b's record | Don't publish; find out which file was used, or rerun 1.6b |
| `npm publish` fails on auth or 2FA | Maintainer fixes their login and retries; nothing changes in the tarball |
| The version already exists on npm | Can't publish over it. Bump, which changes the tarball, so 1.6b reruns |
| `dist.integrity` doesn't match the local file | Deprecate the version on npm (`npm deprecate`), find out why, publish the next version through 1.6b |
| Clean-machine check fails | Deprecate the version with a pointer to the issue, fix with a regression test, release the next version through 1.6b. Unpublishing is a last resort, since npm bars reusing the version |

## Files and areas touched

| Path | Change |
|---|---|
| `plans/README.md` decisions log | A2, A3, A4, D20 (written by the maintainers, or by an agent with their agreement) |
| `plans/HANDOFF.md` | The MVP shipped: version, tarball digest, clean-machine results, links to the run notes |
| [requirements.md](../../requirements.md#proposed-decisions) D6, D13 rows | What shipped |
| Git tag `v<version>` | On the release commit |

No code changes. A code change here means the release goes back through 1.6b.

## Acceptance tests

- The local sha256 equals 1.6b's recorded digest, and the local sha512 integrity equals
  npm's `dist.integrity` for the published version.
- `npx stacks@latest list --json` on the clean machine lists every bundled stack, on
  the lowest D12 Node and the `.node-version` Node.
- `npx stacks@latest new astro-blog <tmp> --sandbox --no-launch --json` writes the
  brief, the manifest and `.gitignore`.

## Exit criteria

- `bun run check` green from the repo root at the release commit.
- A2, A3, A4 and D20 are in the decisions log, and were before the publish.
- `stacks@<version>` is on npm with an integrity matching the gated tarball.
- Every item in the roadmap's [MVP cutline](../../roadmap.md#mvp-cutline) is true.
- HANDOFF.md says the MVP shipped and links the run notes.

## What this plan may get wrong

- A manual publish has no provenance; a user can't verify the package came from this
  repo's commit (open question 20). The digest checks prove only that npm serves the file
  the gate ran, to the maintainers.
- The clean-machine check covers one macOS and one Linux setup. Other npm clients
  (pnpm `dlx`, yarn `dlx`) aren't tested.
- Freezing the tarball means a small mistake found after the gate costs a full gate
  cycle. That is deliberate: the alternative is publishing something no run tested.
