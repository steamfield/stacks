/**
 * Folds the fragments `stacks add` applies into the project's manifest (`.stacks/manifest.json`,
 * the committed record of what was composed and the verify steps).
 *
 * `core/add.ts` calls `mergeAddManifest` with the manifest the project had and the one built for
 * the new fragments; `add/write.ts` writes the result. Existing env values and commands win over
 * incoming ones, because the project owns them once they're there.
 *
 * The verify digest is a hash of the verify steps that `stacks verify` compares against the state
 * record (the per-project file outside the project) before running anything (Trust model point 5).
 * When an untrusted entry joins and no person is at a terminal, the new steps' digest is not
 * recorded (point 4), so the next verify reports the steps as changed and runs nothing until a
 * person accepts them. `core/validate/add-compositions.ts` reuses the same merge to budget briefs.
 */
import type { DetectedAgent, Manifest } from "@steamfield/stacks-format";
import { digestSteps } from "../manifest";

/**
 * Merge checked fragment contributions; the project's existing env values and commands win over
 * incoming ones. The new steps' digest is recorded only when every addition is trusted or a person
 * at a terminal ran the command (trust point 4); otherwise the manifest and state record keep
 * the previous baseline's digest, so verify reports the steps as changed until a person accepts them.
 */
export function mergeAddManifest(input: {
  previous: Manifest | undefined;
  incoming: Manifest;
  name: string;
  untrusted: boolean;
  agent: DetectedAgent;
  stdinIsTTY: boolean;
}) {
  const { previous, incoming } = input;
  const changes: Manifest = {
    ...(previous ?? incoming),
    name: input.name,
    fragments: [...(previous?.fragments ?? []), ...incoming.fragments],
    verify: [...(previous?.verify ?? []), ...incoming.verify],
    env: { ...incoming.env, ...previous?.env },
    commands: { ...incoming.commands, ...previous?.commands },
  };
  const commandsKept = Object.keys(incoming.commands)
    .filter(
      (key) =>
        previous &&
        Object.hasOwn(previous.commands, key) &&
        previous.commands[key] !== incoming.commands[key],
    )
    .sort();
  const digestRecorded = !input.untrusted || (input.agent === "none" && input.stdinIsTTY);
  const baseline = previous ?? { ...incoming, verify: [], env: {} };
  const verifyDigest = digestSteps(digestRecorded ? changes : baseline);
  const manifest = { ...changes, verifyDigest };
  return {
    manifest,
    commandsKept,
    digestRecorded,
    stateManifest: digestRecorded ? manifest : { ...baseline, verifyDigest },
  };
}
