/** Merges an `add`'s contributions into the project manifest and decides which digest to record. */
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
