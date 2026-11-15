/**
 * Keeps text from entries and other untrusted sources from taking over the terminal.
 *
 * Entry names, descriptions, search cards and API responses are written by someone else, and a
 * control character in them (an escape sequence, a carriage return) would let that text move the
 * cursor, recolor the screen or fake a line of output. `printable` escapes those characters before
 * text output or a log message shows them; `hasControl` lets a caller reject such a value outright,
 * as `template.ts::authorValue` does. Report renderers across `core/` and `commands/` use both.
 */

/** C0 and C1 control characters and DEL: what a terminal acts on instead of printing. */
const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);

/** Whether `text` holds a C0 or C1 control character or DEL. */
export function hasControl(text: string): boolean {
  for (const char of text) if (isControl(char.charCodeAt(0))) return true;
  return false;
}

/**
 * `text` with every control character escaped (`\u001b`), for human output and log messages
 * built from entry content, so a file can't move the cursor, color the terminal or start a line.
 */
export function printable(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    out += isControl(code) ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return out;
}
