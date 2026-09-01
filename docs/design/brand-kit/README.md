<!-- @moodforge
schema: 1.0
round: 4
phase: brand-kit
worker: moodforge-brand-architect
theme: sorted
version: v1
created_at: 2026-08-30T00:00:00Z
sha256: c7da40abb334b29a023b76c7e20e5d22a3ec2d03d1a92a640d08051c23ef5688
artifact_role: spec
references: [docs/design/brand-kit/index.html, docs/design/brand-kit/tokens.css, docs/design/brand-kit/tokens.ts, docs/design/brand-kit/tokens.json, docs/design/brand-kit/tailwind.preset.js, content/round3-sorted-v1.html]
summary: Engineer-facing summary of the Sorted brand kit v1 — install, the Tailwind preset, the shadcn/ui migration map, the fifteen motion rules verbatim, and the measured WCAG status with the two documented restrictions.
-->

# Sorted · brand kit v1

**Sorted** is a private, single-user personal finance tracker for India. One person opens it every morning.
Its visual argument is that **colour is the taxonomy and ink is the structure**: a closed set of six
category chips runs the sidebar, tags every row and fills every budget bar, while the layout itself stays
quiet — warm cream, ink hairlines, no shadows, no gradients, no illustration anywhere near a live rupee
figure. The screen opens on **Guilt-Free Money**, not net worth, because that is the only number that
changes what you do next.

The name is **provisional** and this kit is the gate where it gets confirmed or replaced. See
[§ 01 in `index.html`](./index.html#logotype) for the argument on both sides.

---

## Files

| File | What it is |
|---|---|
| `index.html` | The visual brand book. Twelve sections. Open this first. |
| `tokens.css` | **Source of truth.** CSS custom properties. Import once, above everything. |
| `tokens.ts` | Typed twin, plus the measured contrast table and chip metadata. |
| `tokens.json` | DTCG format for Style Dictionary / Figma token plugins. |
| `tailwind.preset.js` | Tailwind 3.4 preset. Wires the tokens into `theme.extend` so `web/tailwind.config.ts` has no duplicated hex. |
| `assets/chips/*.svg` | The six chip icons, as complete 30px chips. |
| `assets/hero/constellation.svg` | The login hero. Static fallback and canonical final frame. |
| `assets/tether.svg` | The Gmail-parser signature mark. |

---

## Install

```bash
# 1 · tokens into the app
#    app/layout.tsx, before globals.css
```

```ts
// web/app/layout.tsx
import '../../docs/design/brand-kit/tokens.css';
import './globals.css';
```

```ts
// web/tailwind.config.ts
import type { Config } from 'tailwindcss';
import sorted from '../docs/design/brand-kit/tailwind.preset.js';

export default {
  presets: [sorted],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
} satisfies Config;
```

```ts
// anywhere you need a token in JS — GSAP, inline SVG, chart libs
import { colors, chips, motion, inr } from '@/../docs/design/brand-kit/tokens';

gsap.to(el, { y: 2, duration: motion.duration.press / 1000, ease: motion.gsapEase.out });
```

Fonts: Bricolage Grotesque, Geist, Geist Mono. Use `next/font` in production rather than the Google Fonts
`<link>` the brand book uses for portability.

---

## The three easing tokens — verbatim, never change these

```css
--ease-out:    cubic-bezier(.23, 1, .32, 1);    /* enter, press, reveal  */
--ease-in-out: cubic-bezier(.77, 0, .175, 1);   /* on-screen movement    */
--ease-drawer: cubic-bezier(.32, .72, 0, 1);    /* drawers and sheets    */
```

There is no fourth curve. If a component seems to need one, it is the wrong component. Changing one of
these three retunes every interaction in the product at once — do not do it without re-reviewing the
whole motion section.

GSAP equivalents, when you need a timeline rather than a transition:

```
--ease-out    → 'power4.out'
--ease-in-out → 'power4.inOut'
--ease-drawer → 'power3.out'
```

---

## The stamp-press rule — LOCKED

This is a **bug fix on record**, not a stylistic preference. It came from the user, against
`content/round3-sorted-v1.html`.

Any component carrying the stamp shadow (`box-shadow: 0 2px 0 var(--ink)`) presses by translating down
**exactly the shadow offset** while the shadow collapses to zero — with **both properties transitioned
together**, one duration, one curve.

```css
/* CORRECT — this is `.stamp` in tokens.css and in the Tailwind preset */
.pill {
  box-shadow: 0 2px 0 var(--ink);
  transition:
    transform  110ms var(--ease-out),
    box-shadow 110ms var(--ease-out);
}
.pill:active:not([disabled]) {
  transform: translateY(2px);
  box-shadow: 0 0 0 var(--ink);
}
```

```css
/* WRONG — never add scale() */
.pill:active { transform: translateY(2px) scale(.985); box-shadow: 0 0 0 var(--ink); }

/* WRONG — transform only; the shadow snaps on frame 1 */
.pill { transition: transform 110ms var(--ease-out); }
```

**Why no scale.** The box-shadow repaint and the GPU-composited scale run on different pipelines. Scaling
a 1.5px hard-edged border against a repainting shadow desyncs — the border appears to shrink or glitch
instead of reading as one clean press.

**Why both properties.** `translateY` and the shadow offset are complementary: on a shared curve they sum
to 2px at every frame, so the shadow's lower edge stays pinned exactly where it started and the button
descends into it. Transition `transform` alone and the shadow drops to zero on frame one — the silhouette
jumps 2px shorter, then the button drifts down to meet nothing. That is a visible flicker on every press.
This was open question #2 from round 3; **it is settled and it ships in `tokens.css`.**

**Scope.** Every component carrying the stamp, not just the button. Today: the primary pill and its `sm`
and `fab` variants. Any future component that takes the stamp takes this press with it.

---

## The fifteen motion rules — verbatim

Rules 1–10 are `emil-design-eng` applied to this brand. Rules 11–15 are Sorted's own.

1. Ask whether it should animate at all. Anything seen a hundred times a day gets no animation.
2. Every animation answers "why". If the answer is "it looks cool" and it's seen daily, cut it.
3. Entering or exiting → `--ease-out`. Moving on screen → `--ease-in-out`. **Never `ease-in`.**
4. UI motion stays under 300ms. Only the modal is allowed 400.
5. Animate `transform` and `opacity` only. Never `width`, `height`, `padding`, `margin`.
6. Never enter from `scale(0)`. Start at `0.95`–`0.97` with opacity.
7. Popovers scale from their trigger. Modals stay centred.
8. Transitions, not keyframes, for anything a person can trigger twice quickly.
9. Exit faster than enter. Slow where the user decides, fast where the system responds.
10. Reduced motion means fewer and gentler, not zero: keep opacity and colour, drop movement.
11. **The stamp press never scales.** translateY matched to the shadow offset, both properties on one curve.
12. **No rupee figure ever animates.** No count-up, no odometer roll. The number is known, or it is a skeleton.
13. **No springs, no bounce, no overshoot** anywhere in the product. A figure that overshoots its final value has lied to the owner for 80ms.
14. **The hero plays once.** A looping hero on a login screen reads as a spinner and implies the app is stuck.
15. **The static SVG is the final frame.** Animation is a layer on top of a complete asset, never a dependency. If GSAP fails to load, the screen is still correct.

> All motion in this product is reviewed by `emil-design-eng`. Change an easing or a duration without
> consulting it and you're breaking the system.

**CSS or GSAP.** CSS for state — presses, hovers, focus, drawer open/close, a filter turning on. CSS
transitions are interruptible, retarget mid-flight, and run off the main thread so they stay smooth while
TanStack Query deserialises a year of transactions. GSAP for sequence — in v1 that is exactly one place,
the login constellation: six staggered chips, a core scale, and a dashoffset draw that must land in order.
Wrap it in `gsap.matchMedia('(prefers-reduced-motion: no-preference)')`.

---

## Shadow policy

**There are no shadows in Sorted.** No blur, no spread, no elevation, no ambient occlusion, nothing that
fakes light. Depth comes entirely from strokes — which is why there are seven stroke weights and why
1.5px is called "the structural weight".

The one exception is the stamp on the primary pill CTA: `0 2px 0 var(--ink)`, zero blur, zero spread.
It is not a lift, it is a stamp — the button sits on the paper and can be pressed into it.

**This exception is not a licence for shadows generally.** Practically: `shadow-none` on shadcn's Card,
`shadow-none` on Sonner toasts, no `backdrop-blur` on any overlay. If you find yourself reaching for a
second shadow, you have found a boundary that wants a border.

---

## Contrast — measured, not asserted

Every ratio below was computed from the hex values using the WCAG 2.1 relative-luminance formula.
Full matrix in [§ 02 of `index.html`](./index.html#colour) and in `tokens.ts` under `contrast`.

| Foreground | Background | Ratio | AA body | Verdict |
|---|---|---|---|---|
| `--ink` `#1A1A1A` | `--bg` `#FAF5F2` | 16.08:1 | Pass | AAA. Body, headings, all borders. |
| `--bg` | `--ink` | 16.08:1 | Pass | Cream label on the ink pill. |
| `--focus` `#14199C` | `--bg` | 11.77:1 | Pass | The ring where it is actually drawn. |
| `--ink` | `--ink-wash` `#F1E8E2` | 14.40:1 | Pass | Active nav row. |
| `--ink` | `--hero-field` `#FCE4CA` | 14.16:1 | Pass | Login hero copy. |
| `--alert` `#A61B2B` | `--bg` | 6.90:1 | Pass | Error text. |
| `--dim-2` `#6B5F57` | `--bg` | 5.71:1 | Pass | All readable secondary prose. |
| `--dim-2` | `--ink-wash` | 5.11:1 | Pass | Idle nav label on a hovered row. |
| **`--dim` `#7D7169`** | `--bg` | **4.37:1** | **Fail** | **Restricted — see below.** |
| **`--rule` `#E2D8D0`** | `--bg` | **1.30:1** | n/a | **Non-text exemption — see below.** |
| **`--focus`** | **`--ink`** | **1.37:1** | **Fail** | **Forbidden combination — see below.** |

### The three flagged rows, and what to do about them

**1 · `--dim` at 4.37:1 fails AA at body size.** It is not removed, because it is load-bearing for the
micro-label rhythm — but it is **restricted**:

- **Permitted:** mono micro-labels only — uppercase, ≥0.13em tracking, ≤11px (`--type-micro`,
  `--type-label`, `--type-meta`). Those are glanced, not read, and the tracking buys back what the ratio
  loses. Field placeholders are the one other allowance, because the field's own label carries the meaning.
- **Forbidden:** any sentence. Helper copy, sub-headings, notice detail, empty-state text, nav labels,
  prose in a table cell.
- **Use instead:** `--dim-2` `#6B5F57` at 5.71:1, which passes at every size.
- **The test:** *if the string contains a verb, it is `--dim-2`.*
- In Tailwind this is the difference between `text-dim` and `text-dim-2`. In shadcn, map
  `--muted-foreground` to `--dim-2`, **not** `--dim`.

**2 · `--rule` at 1.30:1 is a legitimate non-text exemption.** It is a purely decorative row divider.
Row separation is redundantly carried by 13px of vertical padding and by the 30px chip column, so removing
the rule entirely would lose rhythm but not information. Every *actual* component boundary in the system
is `--ink` at 16.08:1, far above 1.4.11's 3:1. **`--rule` must never be used for a component boundary and
must never carry state** (do not use it for a disabled border or an inactive tab).

**3 · `--focus` on `--ink` at 1.37:1 is forbidden by construction.** The focus ring is always drawn
*outside* the element with `outline-offset: 3px`, so it lands on cream at 11.77:1. Never use an inset ring
or `box-shadow: inset` as a ring on an ink-filled control — it would be invisible on the primary CTA.
shadcn's default `ring-offset-background` assumes a white page; override it.

### Chip fills — audited against the correct standard

The chip glyph is a 1.42px stroked graphic, so the applicable requirement is **WCAG 1.4.11 non-text
contrast at 3:1**, not 4.5:1.

| Chip | Hex | Ink glyph on fill | 3:1 non-text | Text-safe |
|---|---|---|---|---|
| food | `#F9ACCE` | 9.80:1 | Pass | yes |
| bills | `#F1A007` | 8.10:1 | Pass | yes |
| invest | `#23B471` | 6.50:1 | Pass | yes |
| transport | `#5483D3` | 4.61:1 | Pass | yes |
| shopping | `#8A4BD1` | 3.32:1 | Pass | **no** |
| health | `#C43C63` | 3.46:1 | Pass | **no** |

**Never set a character inside a shopping or health chip** — no initials, no count, no amount. If a number
must sit beside a chip, it goes outside it, in ink. `tokens.ts` exposes this as
`chipMeta[cat].textSafe` so the rule is enforceable at the type level.

### Colour is never the sole carrier of meaning

All 15 chip pairs pass the separation rule (≥45° hue **or** ≥25 points lightness) — but two pass on one
axis only. **food** (H334 L83) and **health** (H343 L50) are 9° apart in hue and separate on lightness
alone; **transport** and **shopping** are 2 points apart in lightness and separate on hue alone. Under
deuteranopia, bills / invest / health converge into three similar mid-tones.

Therefore: **every chip carries its own glyph, always, at every size, including 22px. A chip with no icon
is a bug, not a variant.** Direction on upcoming rows is an arrow, not a hue.

---

## Icon usage — the `viewBox` rule, LOCKED

Every icon in this system is a `<g>` inside a shared `<defs>` sprite, authored in a **24 × 24**
coordinate space. Consumers pull them with `<use href="#id">`.

```html
<!-- correct -->
<span class="chip"><svg viewBox="0 0 24 24"><use href="#i-food"/></svg></span>

<!-- WRONG — renders at native 24px and clips to the top-left, which reads as "icon not centred" -->
<span class="chip"><svg><use href="#i-food"/></svg></span>
```

**The local `<svg>` must always carry `viewBox="0 0 24 24"`.** This is not optional styling — it is what
maps the 24-unit artwork into the rendered box. `.chip svg` is sized `17 × 17`, and with no `viewBox` the
browser has no instruction to scale 24 units down into 17 pixels, so it draws at native size and clips.

The trap is specific to referencing a **`<g>`**: unlike `<symbol>`, a `<g>` carries no intrinsic viewBox
for the `<use>` to inherit, so nothing supplies the mapping if the host `<svg>` omits it. Sizing the
`<svg>` via CSS or a `style` attribute does **not** substitute for it.

This shipped as a real bug in the first preview build — 42 instances across the screens and this kit —
found by eye as "the arrows and merchant icons look off-centre." Guard it:

- Every `<svg>` wrapping a `<use>` gets `viewBox="0 0 24 24"`. No exceptions.
- The sprite host itself (`<svg width="0" height="0">`) takes no viewBox — it renders nothing.
- Grep for `<svg><use` before shipping. It should return zero.

---

## shadcn/ui migration map

shadcn is **not installed yet** — `web/components/ui/` currently holds hand-rolled `Button.tsx`,
`Card.tsx`, `Input.tsx` and `Toast.tsx`. Replace them; do not run both.

```bash
npx shadcn@latest init
npx shadcn@latest add button input card badge progress separator skeleton label form sonner input-otp
```

Bridge the CSS variables in `app/globals.css` — this is what stops `add button` from looking like default
shadcn:

```css
@import '../../docs/design/brand-kit/tokens.css';

:root {
  --background: var(--bg);
  --foreground: var(--ink);
  --primary: var(--ink);
  --primary-foreground: var(--bg);
  --border: var(--ink);              /* not a grey */
  --input: var(--ink);
  --ring: var(--focus);
  --muted: var(--ink-wash);
  --muted-foreground: var(--dim-2);  /* NOT --dim */
  --destructive: var(--alert);
  --radius: 22px;                    /* --r-panel */
}
```

| Sorted | shadcn primitive | Overrides that matter |
|---|---|---|
| Pill CTA | `button` | Add a `sorted` variant: ink fill, cream text, 1.5px ink border, `rounded-pill`, `shadow-stamp`. **Delete the default `active:scale-[0.98]`** and use the `.stamp` class from the preset. Kill `hover:bg-primary/90` — Sorted buttons have no hover state. Sizes: default 15/30, `sm` 10/20, `icon` 44×44. |
| Ghost / quiet | `button` | `outline` → transparent fill, ink border, ink text, keeps the stamp. `ghost` → borderless, underlined, `underline-offset-4`, no stamp, no press translate. |
| Field | `input` | `rounded-pill`, 1.5px ink, transparent fill, 16px text, 15/22 padding. Replace the ring with `focus-visible:shadow-[0_0_0_2.5px_var(--focus)]`. Placeholder is the one sanctioned `--dim`. |
| Panel | `card` | `rounded-panel`, 1.5px ink, `bg-bg`, **`shadow-none`** — shadcn ships `shadow-sm` and it must go. `CardHeader` padding 22/24, not `p-6`. |
| Budget bar | `progress` | Track `h-track rounded-pill` (16px — **not** `h-20`, which is stock Tailwind's 80px) 1.5px ink, **transparent** (shadcn defaults to a filled muted track). Indicator uses `transform: scaleX()` with `transform-origin: left`. |
| Toast | `sonner` | Replaces the hand-rolled Toast. `rounded-panel`, 1.5px ink, `bg-bg`, `shadow-none`, 4000ms, bottom-right. Success carries the `invest` chip, errors the alert bang — **never a coloured toast background**. |
| Label / Form | `label`, `form` | `FormLabel` → mono micro-label (10px, .16em, uppercase, `--dim`). `FormDescription` → `--dim-2`, never `--dim`. `FormMessage` → ink text with only the bang in `--alert`. |
| Separator | `separator` | Sorted needs two: `hair` = 1px `--rule` (row rhythm) and `panel` = 1.5px `--ink` (structural). Default to `hair`; require an explicit prop for ink. |
| Skeleton | `skeleton` | Swap `animate-pulse` for `animate-chip-pulse` (1150ms, `--ease-in-out`, opacity .34→.72). Ship a `SkeletonRow` composite reproducing the exact row grid with a dashed circle in column one, so nothing reflows on load. |
| Tooltip | `tooltip` | Ink fill, cream mono label, `rounded-pill`, 160ms `--ease-out`. Keep Radix's `--radix-tooltip-content-transform-origin`. |
| Drawer / Dialog | `drawer`, `dialog` | Drawer 320ms `--ease-drawer`; Dialog 400ms `--ease-out` from `scale(.96)`, origin centre. Overlay `rgba(26,26,26,.34)` — **no backdrop blur**. |
| OTP boxes | `input-otp` | The right primitive: a **single input** behind six visual slots, which is what keeps paste, autofill and screen readers working. Restyle slots to 52×60, `rounded-otp`, 1.5px ink, mono 24px. Active slot gets the focus ring, not a fill. |

### No shadcn equivalent — build bespoke

| Component | Why nothing fits |
|---|---|
| **Chip** | `badge` is the nearest primitive and it is wrong. A Badge is a text pill; the chip is a fixed 30px circle whose meaning lives in a glyph. Build `<Chip category icon size />` typed against `ChipToken` so an unknown category cannot compile. **Do not let anyone `add badge` and call it done.** |
| **Tether** | No primitive resembles it. A 16×12 inline SVG in a 22px grid gutter. Ships as `assets/tether.svg` and as a `<Tether />` that renders `aria-hidden`. |
| **Row** | shadcn's `table` is for tabular data with headers. The Sorted row is a 3-column grid with a chip gutter and no header. Build `<Row />`; reach for `table` only if a real data table appears in a later phase. |

**The rule for the whole table:** shadcn gives you behaviour, accessibility and keyboard handling. Sorted
gives you every visual value. **If a shadcn default survives into the product looking like shadcn, the
override was incomplete.**

---

## Implementation checklist

- [ ] `tokens.css` imported once in `app/layout.tsx`, above `globals.css`
- [ ] `tailwind.preset.js` wired via `presets:[sorted]`; **zero hex values left in `web/`**
- [ ] shadcn CSS-variable bridge in `globals.css`; `--muted-foreground` points at `--dim-2`
- [ ] Hand-rolled `Button` / `Card` / `Input` / `Toast` deleted, not left alongside
- [ ] `.stamp` used for every stamp component; **no `scale()` anywhere in a press state**
- [ ] `shadow-none` on Card and on Sonner; no `backdrop-blur` anywhere
- [ ] Every `<Chip>` renders a glyph and has an accessible name
- [ ] No `text-dim` on any string containing a verb
- [ ] Focus rings offset outward on every control; no `outline:none` without a replacement
- [ ] `prefers-reduced-motion` collapses durations and stops the skeleton pulse
- [ ] Login hero renders correctly with JavaScript disabled
- [ ] `grep '<svg><use'` returns zero — every icon wrapper carries `viewBox="0 0 24 24"`

---

## Scope

Every example in this kit is drawn from **login** or **dashboard** only. Accounts, transactions, budgets,
goals, investments, recurring, tax and settings are a later phase and are deliberately not previewed here.
The kit defines primitives those screens will use; it does not design them.
