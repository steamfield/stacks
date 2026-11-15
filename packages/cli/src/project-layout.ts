/**
 * The layout of `.stacks/`, the directory the CLI keeps inside every project it scaffolds.
 *
 * `stacks new` and `stacks add` write it, `verify` and `runs` read it, and report schemas name its
 * paths, so every path lives here once. It holds the brief (`.stacks/BRIEF.md`, the task text for
 * the coding agent), `NOTES.md` (where the agent records findings and questions it asked), the
 * manifest (`.stacks/manifest.json`, the committed record of what was composed and the verify
 * steps), `state/` (verify's run history) and `incoming/` (fragment files parked for a merge by
 * hand). Only the manifest is committed: the `.gitignore` text in `IGNORE` keeps the rest out.
 */
export const METADATA_DIR = ".stacks";
/** A registry root's search sidecar directory (`core/search/sidecar.ts`), outside `.stacks/`. */
export const SEARCH_DIRECTORY = "search";
export const BRIEF_PATH = `${METADATA_DIR}/BRIEF.md`;
export const NOTES_PATH = `${METADATA_DIR}/NOTES.md`;
export const IGNORE_PATH = `${METADATA_DIR}/.gitignore`;
export const INCOMING = `${METADATA_DIR}/incoming`;
export const STATE_DIR = `${METADATA_DIR}/state`;
export const MANIFEST_PATH = `${METADATA_DIR}/manifest.json`;
export const RUNS_PATH = `${STATE_DIR}/runs.jsonl`;
/** The contents of `.stacks/.gitignore`. */
export const IGNORE = "/BRIEF.md\n/NOTES.md\n/state/\n/incoming/\n";
/** The starter `.stacks/NOTES.md`; `core/runs.ts::countAsked` counts items under `## Asked`. */
export const NOTES = "# Notes\n\n## Findings\n\n## Asked\n";

/** Every path a new project writes, sorted; shared by scaffold and canonical brief rendering. */
export const projectFiles = (files: ReadonlyArray<{ path: string }>): string[] =>
  [...files.map((file) => file.path), IGNORE_PATH, BRIEF_PATH, NOTES_PATH, MANIFEST_PATH].sort();
