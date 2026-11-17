# CLI source

| Where | What it owns |
| --- | --- |
| Top level | Node entry point, invocation lifecycle, command tree, configuration, errors and logging |
| `commands/` | Flags, help and result rendering for each subcommand |
| `core/` | Registry, composition, project writes, verify and the other command programs |
| `platform/` | Node adapters for processes, signals, networking and terminal facts |
| `schemas/` | CLI-specific JSON results, events and persisted data shapes |
| `services/` | Effect interfaces for output, host facts, processes and TCP |
| `telemetry/` | Usage events, consent, local storage and delivery |

The architecture map is the file index. [AGENTS.md](../../../AGENTS.md#architecture-map-packagescli)

## Glossary

### Registry and composition

- **Entry.** One stack or fragment, identified by kind and id.
- **Stack.** A recipe for a whole new project.
- **Fragment.** A reusable addition such as CI, git hooks or a database.
- **App and base.** An app is a fragment in category `app` that adds the application.
  The base is the stack and the rest of the fragments.
- **Registry root and origin.** A root is a source of entries. Normal lookup visits
  `project`, `user`, `index` and `bundled` in that order. The project root is the project's
  `.stacks/`, the user root holds personal entries, and the bundled root ships with the CLI
  or comes from `STACKS_REGISTRY_DIR`. `validationRoots` gives the target root priority
  and resolves a bundled validation target in isolation.
- **Candidate, winner and shadows.** A candidate is an entry or rejection loaded from one
  root. The highest-priority candidate for a kind and id wins. Shadows are the origins of
  the copies it hides.
- **Rejected and skipped entries.** A rejection is a candidate the CLI cannot use, for example
  because of bad metadata or an unreadable file. A skipped entry is passed over during loading,
  for example because its schema is too new, allowing a lower root's copy to win.
- **Deep check.** An on-demand walk of an entry's tree to catch symlinks and unreadable paths.
- **Trust.** Whether the CLI treats an entry as trusted for actions such as automatic handoff.
  Entries inherit trust from `localRoot` or `indexRoot`. [Architecture rules](../../../.claude/rules/architecture.md#trust-model)
- **Index.** An optional remote catalog that names downloadable entry bundles. Both the
  official and configured origins use the signed envelope and check bundle digests.
  See `verifyIndex` for the official URL's signature requirement.
- **Signed envelope.** A document carrying the JSON payload as a string, the signing key id
  and a base64 signature.
- **Bundle and digest.** A bundle packages one entry's files as JSON. Its digest is the SHA-256
  of the canonical bundle.
- **Outcome.** A label such as `invalid` or `unsupported` that records how an index request or
  check ended.
- **Pin.** An exact fragment revision named by digest. A pinned composition records the
  digests of all fragments selected for the indexed composition.
- **Composition.** The plan produced by combining selected entries. It includes files, verify
  steps, commands, environment defaults, dependencies and decisions.
- **Via.** How a fragment joined the plan, such as a stack requirement, a stack default,
  `Settings.always`, `--with` or another fragment's requirement.
- **Composition order.** The stack first for `new`, then the fragments in selection order.
- **Preset.** A composition mode. `default` is the usual setup, `sandbox` is for short-lived
  projects, and `lean` omits default fragments and records `default` in the manifest.
- **Conditional block.** Guidance inside `stacks:when` markers that applies only when a
  composition meets its conditions.
- **Adapter and payload.** An adapter supplies files for one target coding agent. A payload
  supplies a stack's example content or one of its named alternatives.
- **Planned file.** An output path and its sources, with a strategy of copy, template or merge.
- **Template values.** Substitutions for `.tmpl` files, such as project name and author.
  Neutral values are fixed substitutions, and neutral files are the files rendered with them.
- **Fingerprint.** A hash identifying content. A composition fingerprint covers the composed
  entries and neutral files. A proof fingerprint covers the stack's own content and verify steps.
- **Run ledger.** The bundled `registry/runs.json` records maintainer proofs. A scaffold proof
  runs without an agent.

### Project and verification

- **Target.** The directory where `new` builds the project.
- **Git probe.** The classification of the target for Git initialization, including a fresh
  directory, a parent repository or a run without Git.
- **Writer and rollback.** The writer creates and replaces project files. Rollback attempts to
  restore rewritten files and remove files created by a failed or interrupted write.
  The error envelope reports unrestored paths in `rollback.incomplete`.
- **Brief.** `.stacks/BRIEF.md`, the task text the CLI generates for the coding agent.
- **Fixed and data lines.** Fixed lines are CLI wording or separators in a brief. Data lines
  come from entries or composition. Word counts distinguish the two for budget checks.
- **Manifest.** The committed `.stacks/manifest.json` recording the composition and verify steps.
- **State record.** A file in the CLI state directory outside the project that holds its verify
  digest baseline and first-green timings.
- **Delta and existing fragments.** The delta is the set of fragments being added. Existing
  fragments are those already in the manifest and can satisfy requirements for the delta.
- **Live and parked files.** A live file is already in the project. A parked file is an incoming
  version kept under `.stacks/incoming/` for a manual merge.
- **Merge needed.** The report's list of parked files grouped by their intended project path.
- **Digest recorded.** Whether `add` recorded the new verify digest as the baseline.
- **Inferred tags.** Tags guessed from project files for evaluating conditional blocks when
  there is no known stack.
- **Recipe notes.** Guidance from the stack or an existing fragment that applies specifically
  when adding a new fragment.
- **Verify step.** One command in the manifest's definition of done.
- **Stage and phase.** Verify runs the base stage before the app stage. Within a stage,
  phases group setup, checks, serve steps and teardown.
- **Scope.** A verify run is `partial` when `--only` or `--skip-tag` supplies a nonempty
  selection, even when every step runs. Other runs have `full` scope.
- **Skipped by default.** Steps omitted by the default verify selection, such as `hygiene`
  steps or `prod` steps in a sandbox project.
- **Failure kind.** Why a step failed. `env` is an environment problem, `step` is a command
  failure, and `timeout` or `interrupted` names what stopped it.
- **Tamper check.** The verify baseline comparison owned by `checkTamper`. Its coverage is
  `full` with a state record or `manifest-only` without one.
- **Run record.** One verify outcome stored as a JSON line in `.stacks/state/runs.jsonl`.
- **Intervention.** A question recorded as a list item under `## Asked` in `.stacks/NOTES.md`.

### Search, validation and submission

- **Search card and vocabulary.** A card is an entry's sidecar with search metadata and
  plain-language copy. The vocabulary maps aliases to known search terms.
- **Override.** A project or user entry with the same kind and id as an index or bundled entry.
- **Tier.** A search hit's fit, ranked `strong`, `partial` or `weak`.
- **Stats population.** Whether published usage figures are measured or seeded for development.
- **Backoff.** A stored wait before another request can be made after a failure.
- **Allowlist.** The signed list of public package names eligible for dependency telemetry.
- **Major and root row.** Dependency reports keep the major version, or the minor too for
  `0.x` versions. The root row is the lockfile record for the project's own package and
  identifies the version it uses directly.
- **Validated set and resolution set.** The validated set is what findings are about. The
  resolution set contains the winning candidates, including rejections. It lets reference
  checks distinguish an unusable entry from an unknown id.
- **Check, finding and size row.** A check examines the validation view. A finding is one
  problem with a check id, severity and source location when available. A size row is a word
  count for an entry body, composed brief or shipped Markdown.
- **Upstream and clone.** Upstream is the registry repository a submission targets. The clone
  is the temporary Git checkout used to assemble and check the submission.
- **Owner and removed id.** An entry's owner is the GitHub login in `authors.json` allowed to
  update it. A removed id is reserved in `removed.json`.
- **Blocker.** A validation finding that prevents a submission.
- **Own branch.** A fork branch whose tip has a submit subject, the current Git author identity
  and a single parent on upstream `main`.
- **Global npm install and detection.** A global npm install lives under npm's global
  prefix. Detection uses `npm prefix -g` to identify it.

### Invocation and output

- **Settings.** Optional values in the user's `config.json`, including composition defaults
  and the telemetry choice.
- **Agent marker.** An environment variable used to detect which coding agent started the CLI.
- **Audience.** One invocation's output format, chosen by `resolveAudience`. `json` is
  machine-readable, `agent` is compact text and `human` is terminal text. The choice affects
  rendering only.
- **Service.** A dependency exposed as an Effect `Context.Service`. Mutable service state is
  scoped to one invocation.
- **Result, error envelope and live event.** A result is the command's JSON object on stdout.
  A failed JSON invocation ends stderr with an error envelope. Live events report verify step
  progress as JSON lines on stderr.
- **Tagged error.** A named failure whose tag determines the fixed message and exit behavior.
- **Defect.** An unexpected fault, such as a throw or a broken invariant. The CLI reports it
  with the fixed `Defect` message.
- **Keeps-result failure.** A failure whose buffered report stays on stdout. `errorTable`
  classifies the tags and `writeFailure` applies the policy.
- **CLI spelling.** The command name used in runnable hints, as stored in `Host.invocation`.
  It can be `stacks` or a version-pinned npx invocation.
- **Help text.** The descriptions, flags, arguments and examples printed by `--help`.
- **Handoff.** How the CLI gives a scaffold or addition to a coding agent. It can launch a
  harness, offer a choice, print a prompt, or leave the work with the current agent.
- **Harness and skill.** A harness is a coding agent's runtime, such as Claude Code or Codex.
  A skill is a folder of instructions the agent can load.
- **Picker.** A numbered terminal prompt for a person's selection.
- **Process group and interactive child.** A process group can be signaled as a unit.
  An interactive child shares the terminal's group.
- **Second signal.** A repeated signal evaluated by `decide` against `SECOND_SIGNAL_MS`.
- **Grace, drain and tail.** Grace is the time for a stopped process group to exit before a
  forced kill. Drain is the time for output pipes to close after exit. The tail is the bounded
  end of the captured output.
- **Live line.** A temporary spinner row redrawn on stderr in human mode.

### Telemetry

- **Consent.** The first applicable reason that decides whether a run can collect telemetry.
- **Store and spool.** The store is the `telemetry/` directory under the CLI state path.
  The spool is its queue of events waiting for delivery.
- **Official entry.** An entry whose id is eligible for telemetry under `official`.
- **Notice run.** An invocation that displays a privacy notice. A scaffold can be deferred
  until a later run can send it.
- **Claim.** An on-disk marker of exclusive work on a notice or a batch of spooled events.
- **Project link.** A local record pairing the manifest id with a random telemetry id and
  preserving scaffold timing and composed step names.
- **Telemetry envelope.** The shared fields of a usage event, such as its event id, install
  id, CLI version and time.
- **Debug mode.** `STACKS_TELEMETRY_DEBUG=1` displays the event as a note in place of
  queueing it.
