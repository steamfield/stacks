import { expect, test } from "vitest";
import { closest } from "../src/core/text/suggest";

test("a transposition counts as one edit", () => {
  // Plain Levenshtein puts both at 2 and the alphabet would put "abit" first.
  expect(closest("lsit", ["abit", "list"])).toEqual(["list", "abit"]);
});
test("ties are broken alphabetically and at most three names come back", () => {
  expect(closest("ab", ["ae", "ad", "ac", "aa"])).toEqual(["aa", "ac", "ad"]);
});
test("nearer names come before alphabetically earlier ones", () => {
  expect(closest("abc", ["aaa", "abd"])).toEqual(["abd", "aaa"]);
});
test("case is ignored when measuring, and the known spelling is returned", () => {
  expect(closest("LIST", ["list", "doctor"])).toEqual(["list"]);
});
test("a distance of 2 is close, and a distance of 3 is not", () => {
  expect(closest("abcdef", ["abcdxy"])).toEqual(["abcdxy"]);
  expect(closest("abcdef", ["abcxyz"])).toEqual([]);
  expect(closest("zzzz", ["list", "doctor"])).toEqual([]);
});
test("ties sort case-insensitively, with the raw spelling as the last tie-break", () => {
  expect(closest("cx", ["Bx", "ax", "aX"])).toEqual(["aX", "ax", "Bx"]);
});
