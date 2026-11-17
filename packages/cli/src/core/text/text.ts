/**
 * Escapes or detects control characters in untrusted text so it cannot move the cursor, restyle
 * the terminal or forge a line of output.
 */

/** C0 and C1 control characters and DEL: what a terminal acts on instead of printing. */
const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);

/** Whether `text` holds a C0 or C1 control character or DEL. */
export function hasControl(text: string): boolean {
  for (const char of text) if (isControl(char.charCodeAt(0))) return true;
  return false;
}

/**
 * Escape controls as literal sequences such as `\u001b` so entry text cannot forge a log line.
 */
export function printable(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    out += isControl(code) ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return out;
}
