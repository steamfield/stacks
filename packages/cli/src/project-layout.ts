/** Project metadata layout, shared by writers, readers and report schemas. */
export const METADATA_DIR = ".stacks";
export const SEARCH_DIRECTORY = "search";
export const BRIEF_PATH = `${METADATA_DIR}/BRIEF.md`;
export const NOTES_PATH = `${METADATA_DIR}/NOTES.md`;
export const IGNORE_PATH = `${METADATA_DIR}/.gitignore`;
export const INCOMING = `${METADATA_DIR}/incoming`;
export const STATE_DIR = `${METADATA_DIR}/state`;
export const MANIFEST_PATH = `${METADATA_DIR}/manifest.json`;
export const RUNS_PATH = `${STATE_DIR}/runs.jsonl`;
export const IGNORE = "/BRIEF.md\n/NOTES.md\n/state/\n/incoming/\n";
export const NOTES = "# Notes\n\n## Findings\n\n## Asked\n";

/** Every path a new project writes, shared by scaffold and canonical brief rendering. */
export const projectFiles = (files: ReadonlyArray<{ path: string }>): string[] =>
  [...files.map((file) => file.path), IGNORE_PATH, BRIEF_PATH, NOTES_PATH, MANIFEST_PATH].sort();
