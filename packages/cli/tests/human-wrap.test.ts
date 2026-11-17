import { stripVTControlCharacters } from "node:util";
import { it } from "@effect/vitest";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { wrap } from "../src/core/text/wrap";

// Known fixture glyphs: 界 uses two columns and the combining acute accent uses none.
const measure = (s: string): number =>
  Array.from(stripVTControlCharacters(s).replaceAll("界", "xx").replaceAll("\u0301", "")).length;
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const escapeSequences = (s: string) => s.match(new RegExp(`${"\u001b"}\\[[\\d;]*m`, "g")) ?? [];

it.prop(
  "wrap preserves words and complete ANSI sequences within the display width [4.4a#6]",
  [
    Schema.Array(
      Schema.Literals(["alpha", "b", "a-very-long-word", "界界", "é", "\u001b[31mred\u001b[39m"]),
    ),
    Schema.Literals([1, 2, 4, 8, 20, 80]),
  ],
  ([tokens, width]) => {
    const input = tokens.join(" ");
    const result = wrap(input, width, measure);
    expect(words(result)).toEqual(tokens);
    expect(escapeSequences(result)).toEqual(escapeSequences(input));
    for (const line of result.split("\n")) {
      if (measure(line) > width) expect(words(line)).toHaveLength(1);
    }
  },
  { arbitrary: { seed: 4401, runs: 150 } },
);

test("wide and combining glyphs use the supplied measure, not string length [4.4a#9]", () => {
  expect(wrap("界界 é é", 5, measure)).toBe("界界\né é");
  expect(wrap("\u001b[31malpha\u001b[39m bravo", 5, measure)).toBe(
    "\u001b[31malpha\u001b[39m\nbravo",
  );
});

test("paragraph breaks, indented code, lists and fence lines survive wrapping [4.4a#9]", () => {
  const protectedLines = [
    "  indented code is wider than the terminal",
    "\tindented with a tab and kept intact",
    "- a list item wider than the terminal",
    "```typescript with a deliberately long fence label",
    "  const value = 'code remains unchanged';",
    "```",
  ];
  const input = `alpha bravo charlie\n\n${protectedLines.join("\n")}\n\ndelta echo`;
  expect(wrap(input, 11, measure)).toBe(
    `alpha bravo\ncharlie\n\n${protectedLines.join("\n")}\n\ndelta echo`,
  );
});

test("empty text and words longer than the terminal need no special caller handling [4.4a#9]", () => {
  expect(wrap("", 20, measure)).toBe("");
  expect(wrap("supercalifragilistic alpha", 5, measure)).toBe("supercalifragilistic\nalpha");
});
