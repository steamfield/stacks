import { WORD_BUDGET, WORDS_PER_SLIDE } from "../data/03-words";

const widest = Math.max(WORD_BUDGET, ...WORDS_PER_SLIDE.map((row) => row.words));
const share = (words: number) => `${(words / widest) * 100}%`;
const summary = WORDS_PER_SLIDE.map((row) => `${row.slide}: ${row.words} words`).join(", ");

/** Slide 3: one bar per slide of this deck, with a marker at the word budget. Drawn by hand to
 * keep the example small; a real chart uses the kit's OpenChart (the visualization skill). */
export function WordBars() {
  return (
    <figure className="word-bars">
      <figcaption className="od-caption">
        Visible words per slide, against the {WORD_BUDGET}-word budget for a conventional slide.
      </figcaption>
      <div role="img" aria-label={`${summary}; budget ${WORD_BUDGET} words.`}>
        {WORDS_PER_SLIDE.map((row) => (
          <div className="word-bar" key={row.slide} aria-hidden="true">
            <span className="word-bar-label">{row.slide}</span>
            <span className="word-bar-track">
              <span className="word-bar-fill" style={{ width: share(row.words) }} />
              <span className="word-bar-budget" style={{ left: share(WORD_BUDGET) }} />
            </span>
            <span className="word-bar-value">{row.words}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
