/** Resolves composition presets for new projects and project additions. */
import type { Manifest } from "@steamfield/stacks-format";
import type { NewPreset } from "../../schemas/new";

export function newPreset(
  flags: { preset?: NewPreset; sandbox: boolean },
  setting?: NewPreset,
): NewPreset {
  return flags.preset ?? (flags.sandbox ? "sandbox" : setting) ?? "default";
}

export function addPreset(recorded: Manifest["preset"] | undefined, sandbox: boolean) {
  return recorded ?? (sandbox ? "sandbox" : "default");
}
