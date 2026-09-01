<!-- @moodforge
schema: 1.0
round: 1
phase: discovery
worker: moodforge-inspiration-scout
theme: tbd
version: v1
created_at: 2026-08-30T00:00:00Z
sha256: 80f3e319a9a7af6d585402f5ac4f997ae3fb4714c9cdc65f613fffc4ab791b27
artifact_role: inspiration
palette: [#F2F9FF, #FAF5F2, #5483D3, #F9ACCE, #23B471, #F1A007, #1A1A1A, #FBA130, #FCE4CA, #14199C, #000000]
fonts: []
summary: Inspiration brief synthesising two playful-premium references (Spotted onboarding, type-showcase app) with real sampled hex values, plus explicit playful-vs-daily-legibility tension analysis for login + dashboard scope.
-->

# Inspiration brief · finance-tracker

## Raw references provided
- Screenshot (Downloads) — "Spotted" onboarding screen. Cream phone canvas, pale-blue page bg, hand-drawn waving-hand illustration in a solid blue circle, left-rail of colour-coded category chips, rounded-sans "WELCOME" headline.
- Screenshot (Downloads) — Type-showcase app on saturated orange. Cream card, deep-royal-blue star mascot with dot eyes, thick black outlines, oversized glyphs/punctuation as graphic elements, black pill CTA "SEGUIR CREANDO".

## Extracted palette candidates (sampled from source pixels)
- **Cream base (ref-1 card):** `#FAF5F2`
- **Cream base (ref-2 card):** `#FCE4CA` — two warm-neutral candidates, pick one as `--bg`
- **Ink / outline / text:** `#000000`–`#1A1A1A` (both refs use true or near-true black for line work and headline text)
- **Accent — royal blue (ref-2 star, ref-1 hero circle):** `#14199C` (deep) / `#5483D3` (mid) — candidate primary accent
- **Accent — orange (ref-2 field bg):** `#FBA130` — candidate secondary/energy accent, NOT base
- **Support — pink:** `#F9ACCE` · **Support — green:** `#23B471` · **Support — mustard:** `#F1A007` (ref-1 category chips — small-dose only)
- **Page-behind bg (ref-1, cooler cream/blue-white):** `#F2F9FF` — a possible alternate cooler base if warm cream feels too close to orange accent

## Typography direction
- **Display:** rounded-geometric sans, confident weight (ref-1 "WELCOME" — think Neue Montreal Rounded, General Sans, or Cabinet Grotesk territory) for headlines, section titles, the hero net-worth label.
- **Numeric / tabular companion:** a disciplined tabular-figure sans or mono (₹ amounts, dashboard stats) — this is the register the reference imagery does NOT show, and must be invented deliberately: rounded display fonts read badly at financial precision. Pair with something like Inter/General Sans tabular-nums or a semi-mono for lakh/crore-grouped figures.
- **Accent glyph play:** ref-2's oversized punctuation/glyph treatment suggests one outsized character (₹, a comma, a decimal point) can be used sparingly as a graphic motif in empty states or the login hero — not on live transaction data.

## Mood words
warm · confident · handcrafted · disciplined · legible · tactile · playful-at-the-edges · trustworthy · unmistakably-Indian (not generic-global fintech)

## Layout tropes to steal
- Generous whitespace framing the hero moment (ref-1) — do not crowd the login illustration.
- Left-rail of small colour-coded circular chips with a simple icon each (ref-1) — natural fit for a dashboard category legend or account-type indicators.
- One oversized, confident headline set tight against a lot of empty space, not centred-shrunk (both refs).
- Flat, unadorned pill CTA — solid fill, no gradient, no shadow blur (ref-2 "SEGUIR CREANDO").
- Restrained mascot: dot eyes + simple mouth, no complex shading (ref-2 star) — cheap to animate, reads instantly at small size.

## Illustration / character territory for the login hero
- A single custom flat-illustrated character or motif, thick ink outline (2–3px), one or two flat accent fills, simple dot-eyes-and-smile face if a character is used at all (borrow ref-2's restraint, not ref-1's busier squiggle linework).
- Candidate objects that read as "Indian personal finance" without being cliché: a gullak (piggy bank), a tijori (vault), a folded ₹ note, a kite (festive, "letting go / control" metaphor), a simple coin — rendered in the house ink+accent linework, not stock iconography.
- Borrow the ref-1 waving-hand gesture directly as the literal "welcome back" beat on login — a hand-drawn wave is cheap to animate (Lottie/Rive) and instantly warm.
- Static SVG fallback mandatory; animation is a delight layer, not a dependency.

## Naming territory (not a final name — explorer/brand-architect to land it)
Three registers worth exploring, all avoiding generic "Finance Tracker":
- **Vault/keeper words** (Hindi-rooted, warm, ownable): Tijori, Kosh, Nidhi, Khazana
- **Plain-confident English, one syllable of warmth:** Sorted, Ledger&, Tally (watch trademark), Balance
- **Companion/character-first naming** (name the mascot, let the app inherit it): the character IS the brand, product name stays secondary/small
Do not resolve this in this brief — hand as open territory to the theme-explorer / brand-architect.

## The tension: playful-premium references vs. a dense daily-use financial tool

Both references are illustrative, character-driven, flat-colour-blocked — genuinely playful. The dashboard is checked daily for real money decisions. Silently sliding to minimalism would betray the references; silently keeping full playfulness on the numbers would make the tool unusable. Position:

- **Where playfulness lives:** the edges only — login hero/character, empty states, success/confirmation toasts, section header ornaments, the mascot's occasional cameo. The numeric core (hero net-worth figure, transaction amounts, table cells, budget bars) stays typographically disciplined: no illustration overlapping numbers, no hand-drawn linework on a ₹ figure.
- **What survives on a daily ₹ number:** confident oversized scale, a single accent-colour hairline-underline or tabular-figure treatment, generous spacing. What gets dropped: squiggly linework, colour-fills behind the number, mascot proximity to live data.
- **Thick outlines / flat colour-blocking → data UI:** becomes 1.5–2px solid ink hairline borders on sections (never fills behind data), small flat-colour circular badges for account-type/category tags (direct lift from ref-1's chip rail), and the moodforge house "no shadows, hairlines only" rule pairs naturally with this reference set — the one exception, a flat stamp shadow (`0 2px 0 var(--ink)`, zero blur) on primary buttons, mirrors ref-2's flat black pill CTA almost exactly.
- **Failure mode to name and avoid:** "birthday-card dashboard" — every stat card wearing a hand-drawn icon and a colour fill until the eye can't find the number. If a screen needs more than one accent colour-block near live data, it has crossed the line.

## Explicit anti-patterns (what to avoid)
- No 3D render on login (de-scoped by user; do not reintroduce as a hybrid).
- No drop shadows or blur anywhere except the single flat stamp-shadow on primary CTAs.
- No mascot or illustration touching/overlapping live transaction or net-worth figures.
- No generic shadcn-default look — the register is playful-premium, not stark-minimal.
- No purely corporate-global fintech palette (cold blue-on-white SaaS look) — warmth and cream base are load-bearing.

## One-sentence brief for the theme-explorer
A playful-premium Indian personal finance tool — warm cream base, deep royal-blue + orange-accent flat colour-blocking, thick ink hairline outlines, a restrained hand-illustrated character/wave as the one login hero moment, rounded-geometric display type paired with a disciplined tabular numeral face for ₹ figures — with all playfulness pushed to the edges (login, empty states, success moments) so the daily net-worth and transaction numbers stay fast, quiet, and legible.
