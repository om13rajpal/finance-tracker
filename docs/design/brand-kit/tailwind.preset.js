/* @moodforge
schema: 1.0
round: 4
phase: brand-kit
worker: moodforge-brand-architect
theme: sorted
version: v1
created_at: 2026-08-30T00:00:00Z
sha256: fee2229964bd28a0f9ce2fc77b816f1af18aa86fd34d6851e6742db06e1e1281
artifact_role: tokens
exports: [theme.extend, plugin:stamp, plugin:chip-vars]
summary: Tailwind 3.4 preset wiring the Sorted tokens into theme.extend so web/tailwind.config.ts consumes the kit directly instead of duplicating hex values. Ships the stamp-press utility and the shadcn CSS-variable bridge.
*/

/**
 * SORTED · Tailwind preset
 *
 * Usage in web/tailwind.config.ts:
 *
 *   import type { Config } from 'tailwindcss';
 *   import sorted from '../docs/design/brand-kit/tailwind.preset.js';
 *
 *   export default {
 *     presets: [sorted],
 *     content: ['./app/**\/*.{ts,tsx}', './components/**\/*.{ts,tsx}'],
 *   } satisfies Config;
 *
 * Then import tokens.css once in app/layout.tsx (before globals.css) so the
 * custom properties exist. The preset references those properties rather
 * than inlining hex, which means a token change propagates without a build.
 */

const plugin = require('tailwindcss/plugin');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'], // Sorted is light-first. No dark theme is defined in v1.
  theme: {
    extend: {
      colors: {
        bg:          'var(--bg)',
        ink:         'var(--ink)',
        rule:        'var(--rule)',
        'ink-wash':  'var(--ink-wash)',
        'hero-field':'var(--hero-field)',
        /** 4.37:1, mono micro-labels ONLY. text-dim on a sentence is a bug. */
        dim:         'var(--dim)',
        /** 5.71:1, required for readable secondary prose. */
        'dim-2':     'var(--dim-2)',
        focus:       'var(--focus)',
        alert:       'var(--alert)',
        bucket: {
          fixed:     'var(--bucket-fixed)',
          invest:    'var(--bucket-invest)',
          savings:   'var(--bucket-savings)',
          guiltfree: 'var(--bucket-guiltfree)',
        },

        // ── shadcn/ui bridge ────────────────────────────────────────────
        // shadcn components read these names. Mapping them to Sorted tokens
        // is what stops `npx shadcn add button` from looking like default
        // shadcn. Pair with the CSS variable block in README.md.
        background:  'var(--bg)',
        foreground:  'var(--ink)',
        border:      'var(--ink)',
        input:       'var(--ink)',
        ring:        'var(--focus)',
        primary:     { DEFAULT: 'var(--ink)', foreground: 'var(--bg)' },
        secondary:   { DEFAULT: 'transparent', foreground: 'var(--ink)' },
        muted:       { DEFAULT: 'var(--ink-wash)', foreground: 'var(--dim-2)' },
        accent:      { DEFAULT: 'var(--ink-wash)', foreground: 'var(--ink)' },
        destructive: { DEFAULT: 'var(--alert)', foreground: 'var(--bg)' },
        card:        { DEFAULT: 'var(--bg)', foreground: 'var(--ink)' },
        popover:     { DEFAULT: 'var(--bg)', foreground: 'var(--ink)' },
      },

      fontFamily: {
        disp: ['var(--disp)'],
        sans: ['var(--ui)'],
        num:  ['var(--num)'],
      },

      fontSize: {
        // [size, { lineHeight, letterSpacing, fontWeight }]
        micro:     ['9.5px',  { lineHeight: '1.2',  letterSpacing: '0.13em' }],
        label:     ['10px',   { lineHeight: '1.2',  letterSpacing: '0.16em' }],
        meta:      ['11px',   { lineHeight: '1.2',  letterSpacing: '0.20em' }],
        caption:   ['13.5px', { lineHeight: '1.45' }],
        'body-s':  ['14.5px', { lineHeight: '1.25' }],
        body:      ['15px',   { lineHeight: '1.55' }],
        input:     ['16px',   { lineHeight: '1.4'  }],
        h3:        ['22px',   { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '800' }],
        h2:        ['26px',   { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '800' }],
        h1:        ['40px',   { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '800' }],
        'figure-2':['52px',   { lineHeight: '1',    letterSpacing: '-0.02em',  fontWeight: '500' }],
        'figure-1':['108px',  { lineHeight: '0.95', letterSpacing: '-0.02em',  fontWeight: '500' }],
        wordmark:  ['180px',  { lineHeight: '0.9',  letterSpacing: '-0.035em', fontWeight: '800' }],
      },

      letterSpacing: {
        disp:  '-0.035em',
        num:   '-0.02em',
        label: '0.16em',
        micro: '0.13em',
      },

      spacing: {
        2: '2px', 4: '4px', 6: '6px', 8: '8px', 10: '10px', 12: '12px',
        14: '14px', 18: '18px', 22: '22px', 26: '26px', 32: '32px',
        44: '44px', 64: '64px', 96: '96px',
        chip: '30px',   // the chip diameter, used as the row grid's first column
        track: '16px',  // budget-bar track height. Deliberately off the 2px scale:
                        // 14px reads thin under a 30px chip, 18px competes with it.
                        // Named so nobody reaches for h-20 (= stock Tailwind 80px).
        rail: '232px',  // the sidebar
      },

      borderWidth: {
        hair: '1px', panel: '1.5px', tether: '1.6px',
        icon: '2px', focus: '2.5px', display: '4px', core: '4.5px',
      },

      borderRadius: {
        xs: '4px', sm: '14px', otp: '16px', notice: '18px',
        panel: '22px', card: '26px', pill: '999px',
      },

      // The ONLY two shadows that exist. Everything else is a border.
      boxShadow: {
        stamp: '0 2px 0 var(--ink)',
        'stamp-pressed': '0 0 0 var(--ink)',
        none: 'none',
      },

      transitionTimingFunction: {
        out:    'cubic-bezier(.23, 1, .32, 1)',
        'in-out':'cubic-bezier(.77, 0, .175, 1)',
        drawer: 'cubic-bezier(.32, .72, 0, 1)',
      },

      transitionDuration: {
        press: '110ms', hover: '150ms', tooltip: '160ms',
        dropdown: '200ms', drawer: '320ms', modal: '400ms',
      },

      gridTemplateColumns: {
        // The row: chip · content · amount. The single most repeated
        // layout in the product.
        row: '30px 1fr auto',
        // The tether gutter variant: an empty 22px column on manual rows.
        //
        // The chip track is 44px, not 30px: the 30px chip PLUS its 14px
        // gutter. It has to be baked into the track because this row runs at
        // column-gap 0, the tether must sit tight against the chip it leads
        // into, so the row cannot simply use gap-x-14 like the plain row does.
        //
        // And a margin on the chip does NOT work: margin on a grid item shifts
        // that item inside its own track and never pushes the next one, so
        // `mr-14` on a 30px chip in a 30px track moved nothing and every name
        // in the ledger sat flush against its chip. Shipped and only caught by
        // looking at it.
        'row-tether': '22px 44px 1fr auto',
      },

      keyframes: {
        'chip-pulse': { '0%,100%': { opacity: '.34' }, '50%': { opacity: '.72' } },
      },
      animation: {
        // The chip-rhythm skeleton: the loading state has the same silhouette
        // as the loaded state, so nothing reflows when data lands.
        'chip-pulse': 'chip-pulse 1150ms cubic-bezier(.77,0,.175,1) infinite',
      },
    },
  },

  plugins: [
    plugin(function ({ addUtilities, addComponents, addBase }) {
      addBase({
        // Focus is visible on everything, always, and offset outward so it
        // lands on cream. --focus on --ink measures 1.37:1: an inset ring on
        // the primary CTA would be invisible.
        '*:focus-visible': {
          outline: '2.5px solid var(--focus)',
          outlineOffset: '3px',
          borderRadius: '4px',
        },
        '::selection': { background: 'var(--bucket-guiltfree)', color: 'var(--ink)' },
      });

      addComponents({
        /**
         * .stamp: the one permitted shadow in the system.
         * LOCKED press rule: translateY exactly the shadow offset, shadow
         * collapsed to zero, BOTH transitioned over one duration and one
         * curve. Never scale(): the shadow repaint and a composited scale
         * run on different pipelines and a 1.5px hard border glitches.
         */
        '.stamp': {
          boxShadow: '0 2px 0 var(--ink)',
          transition:
            'transform 110ms cubic-bezier(.23,1,.32,1), box-shadow 110ms cubic-bezier(.23,1,.32,1)',
        },
        '.stamp:active:not([disabled]):not([data-disabled])': {
          transform: 'translateY(2px)',
          boxShadow: '0 0 0 var(--ink)',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '.stamp': { transitionDuration: '1ms' },
          '.stamp:active:not([disabled])': { transform: 'none' },
        },
      });

      addUtilities({
        // Every rupee figure. Without tabular-nums an amount column jitters
        // as digits change and the ledger stops being scannable.
        '.money': {
          fontFamily: 'var(--num)',
          fontWeight: '500',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        },
      });
    }),
  ],
};
