# Frontend design slop

AI design slop is the visual fingerprint of a model that averaged instead of chose. Asked for a section, a model emits the modal answer from shadcn/Tailwind marketing pages: a tracked-out uppercase label, a heading, a subheading that paraphrases the heading, three identical rounded cards, a Sparkles icon, a gradient. None of it is ugly. All of it is recognizable, and readers have learned to read it as "nobody designed this."

The root cause is page-level. A model re-derives each section on its own, so every section gets the same anatomy and the same weight, and nothing has a budget for emphasis. The fix is to decide once, per page, what matters most, and let only that carry the weight.

Read `DESIGN.md` first. This guide covers what it doesn't: structural and copy-in-UI patterns that stay generic even when every token is right.

## The two tests

The deletion test. Delete the element. If nothing is lost, it was decoration. Applies to labels, subheadings, icons, badges, dots, and cards. Run it on every label and sub line before shipping.

The 25% zoom test. Zoom out until you can't read the text. If you can't tell which part of the page matters most, the page has no hierarchy. Vary the container by the job: a thread, a dense row, a single sentence and a link.

## Eyebrows, kickers, overlines

The tell is a three-line stack: `KICKER` / heading / sub that restates the heading. The reader parses three lines to get one.

An eyebrow earns its place only when it adds a fact the heading lacks:

| Legitimate | Example |
| --- | --- |
| Category on a listing item | `Tool`, `Export` |
| Status or recency | `Updated Sept 2026`, `Beta` |
| A real step in a sequence the reader follows | `Step 2 of 4` |

It's slop when it's a paraphrase of the heading below it, present on every section, a mood word (`THE PICTURE`), numbered when the sections aren't steps, or itself a heading element (eyebrows are `<span>` or `<p>`).

The same test applies to the sub line: keep it only when it adds a scope, a number, a constraint, or a caveat.

Default for a header in app UI: heading, an optional one-line sub with real content, an action slot. No kicker.

## Where uppercase tracked text is fine

It's slop when it labels a section and fine when it labels a field: table column headers, form group labels in a control panel, the label under a value, a group label in a picker, a compact status badge. Field labels sit next to a value or control and name it; section kickers sit above a heading and repeat it.

## Catalog

Every grep hit needs the deletion test, not a blanket rewrite.

### Typography and labels

| Pattern | Grep | Instead |
| --- | --- | --- |
| Kicker above a heading | `rg -B2 -A4 "uppercase" app --glob '*.tsx'` | Drop it, or make it carry a fact |
| Sub that restates the heading | read the pairs | Delete, or make it a constraint |
| Uppercase as decoration on prose, buttons, nav | `rg "uppercase" app` | Sentence case; size and weight for hierarchy |
| Numbered sections that aren't steps | `rg "0[1-9]" app --glob '*.tsx'` | Remove the number |
| One italic serif accent word in a headline | `rg "font-serif" app` | Consistent hierarchy |

### Layout

| Pattern | Grep | Instead |
| --- | --- | --- |
| Every section the same anatomy | walk the page | Vary the container by job; one dominant section |
| Three identical feature cards | `rg "grid-cols-3" app` | A list, a table, two columns, or one dominant tile |
| Everything in a bordered rounded card | `rg "rounded-xl border" app` | Whitespace and proximity; cards only for things you act on |
| Nested cards | read the tree | One level |
| Centered hero, big headline, two buttons | `rg "text-center" app` | Start with what the user needs; one action |
| Stat tiles with no comparison or source | `rg "tabular-nums" -B2 -A4 app` | Numbers in context, with provenance |
| Mixed spacing on siblings | `rg "\[[0-9]+px\]" app` | One scale per component family |

### Color and surface

| Pattern | Grep | Instead |
| --- | --- | --- |
| Gradient text, borders, hero washes | `rg "gradient" app` | Flat text and borders |
| Glow | `rg "shadow-\[0_0" app` | Luminance steps (DESIGN.md, Shape and depth) |
| Accent spread thin | `rg "text-primary" app` per file | Accent only on actions and active state |
| Colored left border per card | `rg "border-l-" app` | Status color only for real state |
| Emerald/amber text without a state behind it | `rg "text-emerald\|text-amber" app` | Status colors only for status |

### Icons and decoration

| Pattern | Grep | Instead |
| --- | --- | --- |
| Sparkles for anything AI | `rg "Sparkles" app` | Name the action |
| Icon in a tinted tile above every title | `rg "rounded-(md\|lg) bg-.*/1[05]" app` | Icons only where they tell things apart |
| Accent dot before a label | `rg "rounded-full bg-primary" app` | Nothing |
| Badge on every heading | `rg "rounded-full.*uppercase" app` | Badges for real state |
| Emoji as icon | `rg -P "[\x{1F300}-\x{1FAFF}]" app` | Icon set, or text |
| Arrow after every link | `rg "ArrowRight\|→" app` | Links look like links |

### Motion

| Pattern | Grep | Instead |
| --- | --- | --- |
| Entry animation on everything, including history | `rg "anim-" app` per file | Motion for what changed (DESIGN.md, Motion) |
| Spring or bounce | `rg "bounc\|spring" app` | Never |
| Pulsing decorative element | `rg "animate-pulse\|anim-pulse" app` | Only for real waiting state |
| Hover scale | `rg "hover:scale" app` | A luminance change |

### Copy in UI

| Pattern | Instead |
| --- | --- |
| Effortless, Seamless, Powerful, Unlock, Supercharge | A verb that names what happens |
| "Everything you need to…", "Built for…", "How it works" | Read the headings aloud; they should only fit this app |
| Mood-word labels | A fact, or nothing |
| "Ask anything, in plain English" | Say what the reader can do here |

## Reviewing a page

1. Screenshot at 25% zoom. Name the part that matters most. If you can't, fix hierarchy before touching labels.
2. Read only the headings in order. They should be about this page's content.
3. Deletion test on every label and sub line.
4. Count cards. Each should be something you can act on.
5. Count accent uses. One accent job per view.
6. Count icons. Each should tell two things apart.
7. Check grids. Three identical cards means the content was fitted to a template.
