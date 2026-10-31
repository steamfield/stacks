# Styling

Read `DESIGN.md` at the repo root before a visual change; token values live in `app/app.css`. Before adding a section header, label, card, badge, empty state, or hero, read [design-slop](design-slop.md) (Claude also has it as the `frontend-design-slop` skill): it covers the generic "made by an LLM" patterns that stay generic even when every token is right.

## The styling ladder

Three tiers, in order. Take the next one only when the one above can't express what you need.

1. Tailwind utilities in the markup. Spacing, color, type, layout, borders, radius, one-offs. Semantic tokens (`bg-card`, `text-muted-foreground`), on-scale values (`h-13`, `max-w-180`, `size-8.5`, `tracking-tight`, not `h-[52px]`). Arbitrary values are for values that are genuinely off-scale.
2. CSS, for what utilities can't express (the table below). Shared motion and structural classes go in `app/app.css` under `@layer components` (unlayered rules beat every utility). CSS that belongs to one component goes in a co-located `Thing.module.css`, imported as `styles`; Vite scopes the names, so keep them short (`.title`). State is a `data-*` attribute or an `is-*` class, never encoded in the class name. No BEM.
3. Inline `style` only for values computed in JS: a CSS custom property set from state, a width from data.

| You're styling | Use |
| --- | --- |
| Spacing, color, type, flex, grid, borders, radius | Utilities |
| `@keyframes` and the rules that drive them | `app.css` (shared) or a CSS module |
| `::before`/`::after`, `::-webkit-*` controls | CSS module |
| `nth-child` logic, complex descendant selectors | CSS module |
| `mask-image`, `clip-path`, `clamp()` type | CSS module |
| Theme tokens (`@theme`), base resets | `app.css` |

## Linted

`biome-plugins/styling.grit` fails `bun run lint` (and the post-edit lint hook) on these, with the fix in the message: arbitrary sizes where the scale has a value (`text-[13px]`, `ring-[3px]`); Tailwind palette colors and hex in classes (tokens only; `emerald-*`/`amber-*` for real status); `font-bold` and heavier; ungated `animate-pulse`/`spin`/`bounce`/`ping`; `duration-*`/`ease-*` classes (the theme sets the default duration and easing); a `transition-*` without `motion-safe:`. `app/components/ui/` is exempt from the size and color checks, not the motion ones, so keep it in Biome's includes and give each shadcn component you add a motion pass (it ships `duration-*` and ungated `transition-*`). If a rule is wrong for a case, change the plugin, don't route around it.

## Not linted

- A new `--text-*` size uses a t-shirt name (`2xs`, `md`, `3xl`). `cn` (the `cn` package, a tailwind-merge replacement) reads any other `text-*` as a color, so `cn("text-muted-foreground", "text-body")` silently drops the color.
- Animate only with the `anim-*` classes (DESIGN.md, Motion, says why). `anim-module` wraps exactly one child; don't nest two that mount together.
- Settled history doesn't animate: gate entry classes on "arrived in this session". `tests/message-list.test.tsx` checks it for messages.
- Re-animate by changing `key`. Keep keys stable otherwise.
- No spring, bounce, scale, or `hover:scale-*`. No hand-written `will-change`. No `matchMedia` in components.
- A JS animation library (`motion`, framer-motion) needs a design discussion before it's added.

## Avoid

- Inline `style` for static values; `!important` except to override a third-party library or inside a reduced-motion or print block.
- `@apply` to dedupe markup. Extract a component or a `.map()`. In a CSS file, use `var(--color-card)` rather than `@apply`.
- A per-component CSS file for things utilities can express.
- CSS-in-JS.
