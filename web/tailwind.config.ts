import type { Config } from "tailwindcss";

// The Sorted brand kit is the single source of truth for every design token.
// `web/` carries ZERO hardcoded hex values: everything resolves through the
// preset to the CSS custom properties in app/tokens.css (generated from
// docs/design/brand-kit/tokens.css by scripts/sync-tokens.mjs).
//
const sortedPreset = require("../docs/design/brand-kit/tailwind.preset.js");

export default {
  presets: [sortedPreset],
  // `lib/` IS a content root and leaving it out is not a style nit.
  // buckets.ts is the single place the four bucket fills are named
  // (`bg-bucket-fixed` and friends), so with lib/ unscanned Tailwind emitted
  // only `bg-bucket-invest`, the one that happened to also appear literally in
  // a landing-page component. Three of the four chips and three of the four
  // budget bars rendered with NO FILL, which reads as a design choice rather
  // than as a missing stylesheet, and no type error or test can catch it.
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
