/** Punctuation folds before phrase matching; Unicode letters remain searchable. */
export const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export const STOP = new Set(
  "a an the and or for of to in on with from by at as my our your their its it is are be i we you they me can that this have has do how use using app apps project tool thing something build make want".split(
    " ",
  ),
);
export const stem = (word: string) =>
  word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
export const tokens = (text: string): string[] =>
  words(text)
    .filter((word) => !STOP.has(word))
    .map(stem);
/** First request spelling for each content stem; matching still uses tokens. */
export function surfaceForms(text: string): Map<string, string> {
  const forms = new Map<string, string>();
  const normalized = text.toLowerCase();
  let offset = 0;
  // Lowercase the whole request for contextual casing, then map its spans back to the
  // original words. A lowercase character can expand (İ becomes i plus a combining dot).
  for (const [surface] of text.matchAll(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu)) {
    const end = offset + surface.toLowerCase().length;
    for (const key of tokens(normalized.slice(offset, end)))
      if (!forms.has(key)) forms.set(key, surface);
    offset = end;
  }
  return forms;
}
export function phraseFrom(text: string, phrase: string): string | undefined {
  const needle = words(phrase);
  if (needle.length === 0) return undefined;
  const source = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const index = source.findIndex((_, at) =>
    needle.every((word, i) => source[at + i]?.[0].toLowerCase() === word),
  );
  if (index < 0) return undefined;
  const start = source[index];
  const end = source[index + needle.length - 1];
  return start && end ? text.slice(start.index, end.index + end[0].length) : undefined;
}
export const phraseIn = (text: string, phrase: string): boolean =>
  phraseFrom(text, phrase) !== undefined;
