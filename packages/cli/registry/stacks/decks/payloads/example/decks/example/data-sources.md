# Example deck: data provenance

## Slide 1 (01-cover): A deck is a folder of slides you can review like code.

No factual claims.

## Slide 2 (02-one-claim): Each slide makes one claim.

No factual claims. The bullets restate the `writing-slides` skill's rules.

## Slide 3 (03-figure): Every slide in this deck stays under the word budget.

| Claim / constant | Value and units | Status | Source / query | Retrieved / as of |
| --- | --- | --- | --- | --- |
| `WORDS_PER_SLIDE` | 22, 33, 35, 20 visible words for slides 1 to 4 | VERIFIED | Counted by hand from `slides/*.mdx` and the bar labels and values in `components/WordBars.tsx` | 2026-11-15 |
| `WORD_BUDGET` | 70 visible words | VERIFIED | `writing-slides` skill, budget table: "About 70 visible words" for a normal conventional slide | 2026-11-15 |

Definition: visible words are every word rendered on the slide (headline, captions, bullets, bar labels and values), counting a hyphenated word and a number as one word each. Speaker notes are excluded.
Derivation and display rounding: none; counts are shown as whole numbers.
Conflicts and chosen source: none.

## Slide 4 (04-close): Start your own deck from these patterns.

No factual claims.

## Refresh before the talk

| Pending item | What resolves it | Owner |
| --- | --- | --- |
| Word counts after any slide edit | Recount the edited slide and update `data/03-words.ts` and this table | Whoever edits the slide |
