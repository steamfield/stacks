/**
 * Measures how many terminal columns a string takes, so human output can wrap lists and fit the
 * live spinner line to the terminal's width. `bin.ts` hands `stringWidth` to `Host`; commands
 * pass `Host.stringWidth` to `core/wrap.ts`, and `services/output.ts` measures with it too.
 *
 * A character's width isn't its length: an emoji or a CJK character fills two columns, a combining
 * accent fills none, and escape sequences fill none. Text is split into graphemes (what a reader
 * sees as one character) so an emoji built from several code points is counted once.
 */
import { stripVTControlCharacters } from "node:util";

/** Terminal columns for graphemes, without splitting emoji or combining sequences. */
export function stringWidth(text: string): number {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let width = 0;
  for (const { segment } of segments.segment(stripVTControlCharacters(text))) {
    if (/^[\p{Mark}\p{Control}\p{Format}]+$/u.test(segment)) continue;
    const code = segment.codePointAt(0) ?? 0;
    width += /\p{Emoji_Presentation}|\uFE0F|\u20E3/u.test(segment) || wide(code) ? 2 : 1;
  }
  return width;
}

function wide(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}
