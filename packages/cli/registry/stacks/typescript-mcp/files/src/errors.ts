/**
 * Defines the fixed tool-error messages a model can act on and the generic unexpected-failure
 * message. The tool runner uses these to keep host paths and exception details out of protocol
 * responses.
 */

export const TOOL_ERRORS = {
  invalid_path:
    "The path must be relative to the server's root directory, such as notes/todo.md, with no leading / and no ../ segments.",
  outside_root:
    "The path resolves outside the server's root directory (through ../ or a symbolic link). Pass a path inside the root.",
  not_found: "No file exists at that path under the root. Check the spelling and the directory.",
  not_a_file: "That path is a directory or a special file. Pass the path of a regular file.",
  too_large:
    "The file is larger than the server's read limit (MAX_FILE_BYTES). Ask for a smaller file.",
  not_text: "The file isn't UTF-8 text. This tool reads text files only.",
} as const;

export type ToolErrorCode = keyof typeof TOOL_ERRORS;

/** A failure the model caused or can work around. The tool runner turns it into `isError: true`. */
export class ToolError extends Error {
  override name = "ToolError";
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode) {
    super(TOOL_ERRORS[code]);
    this.code = code;
  }
}

/** The text a model sees for a failure that isn't a ToolError: no detail leaves the server. */
export const INTERNAL_ERROR_MESSAGE =
  "The tool failed unexpectedly. The server logged the error; trying again won't help until it is fixed.";
