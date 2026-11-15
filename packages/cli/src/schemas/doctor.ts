/**
 * The shape of what `stacks doctor --json` prints: the facts someone needs to debug an install,
 * such as the version, the directories the CLI reads and writes, whether the bundled registry and
 * skill were found, the remote index's cache state and any error reading `config.json`.
 * `core/doctor.ts` builds it.
 */
import { Schema } from "effect";
import { NoticeFields } from "./notice";
import { RemoteStatus } from "./remote-index";

/** Local diagnostics; every field is readable even when `config.json` is broken. */
export const DoctorReport = Schema.Struct({
  ...NoticeFields,
  version: Schema.String,
  platform: Schema.String,
  executable: Schema.String,
  paths: Schema.Struct({
    config: Schema.String,
    data: Schema.String,
    cache: Schema.String,
    cwd: Schema.String,
    /** The user registry root (user stacks and fragments). */
    user: Schema.String,
  }),
  /** The bundled registry root, and whether it exists. */
  registry: Schema.Struct({ path: Schema.String, found: Schema.Boolean }),
  /** The bundled skills root, and whether stacks/SKILL.md exists in it. */
  skill: Schema.Struct({ path: Schema.String, found: Schema.Boolean }),
  remoteIndex: RemoteStatus,
  configErrors: Schema.Array(Schema.String),
}).annotate({
  title: "Doctor report",
  description: "Local CLI runtime and configuration diagnostics",
});
export type DoctorReport = typeof DoctorReport.Type;
