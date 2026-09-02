"use client";

import * as React from "react";
import gsap from "gsap";

/**
 * Sorted · login hero
 *
 * Four bucket chips orbiting a rupee core, joined by the dotted connector
 * stroke. This is the one big illustrative moment in the entire product;
 * everywhere past the login door the system is disciplined.
 *
 * FOUR orbs, not six. The hero used to carry the six invented category chips.
 * Two of those colours (#8A4BD1, #C43C63) were retired with that taxonomy, so
 * keeping six would leave this screen as the sole home of two hexes that exist
 * nowhere else in the system. The constellation's meaning comes from it BEING
 * the taxonomy: decoupled to ornament it is just dots.
 *
 * MOTION, all locked:
 *
 *  · The entrance plays ONCE per mount and never loops. A looping hero reads
 *    as a spinner, which is the failure mode for this exact idea.
 *
 *  · The stage gesture: on email → code, the six connectors advance their dash
 *    pattern by exactly one 10-unit cycle (dasharray `4 6`) over 320ms. Because
 *    the pattern is periodic, the final frame is pixel-identical to the first.
 *    That is the whole trick: the gesture can be skipped under reduced motion,
 *    with JS disabled, or on a slow paint, at zero cost. It can never become a
 *    dependency.
 *
 *  · STATIC FALLBACK IS MANDATORY. Nothing here is hidden in markup. The SVG
 *    renders complete and correct with JavaScript off; GSAP only sets the
 *    pre-entrance state at runtime, inside the effect.
 */

const ORBS = [
  { id: "guiltfree", cx: 96, cy: 84, fill: "var(--bucket-guiltfree)", label: "Guilt-free" },
  { id: "invest", cx: 330, cy: 96, fill: "var(--bucket-invest)", label: "Investments" },
  { id: "savings", cx: 336, cy: 288, fill: "var(--bucket-savings)", label: "Savings" },
  { id: "fixed", cx: 86, cy: 280, fill: "var(--bucket-fixed)", label: "Fixed costs" },
] as const;

/** Core-edge → orb-edge, so the dots never tuck under a circle. */
const LINKS = [
  "M163 146 L118 104",
  "M260 151 L306 115",
  "M261 229 L312 270",
  "M158 228 L110 262",
] as const;

const ICONS: Record<string, React.ReactNode> = {
  fixed: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    </>
  ),
  invest: (
    <>
      <path d="M4 16.6 9.2 10l3.8 3.8L19.4 5" />
      <path d="M14.8 5h4.8v4.8" />
    </>
  ),
  savings: (
    <>
      <ellipse cx="12" cy="6.6" rx="7.2" ry="2.8" />
      <path d="M4.8 6.6v10.8c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8V6.6" />
      <path d="M4.8 12c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8" />
    </>
  ),
  guiltfree: (
    <>
      <path d="M12 3.4v3.1M12 17.5v3.1M3.4 12h3.1M17.5 12h3.1" />
      <path d="M6.2 6.2 8.4 8.4M15.6 15.6l2.2 2.2M17.8 6.2 15.6 8.4M8.4 15.6l-2.2 2.2" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ),
};

export function HeroConstellation({ stage }: { stage: "email" | "code" }) {
  const root = React.useRef<SVGSVGElement>(null);
  const played = React.useRef(false);
  const prevStage = React.useRef(stage);

  // Entrance, once, on mount.
  React.useEffect(() => {
    const el = root.current;
    if (!el || played.current) return;
    played.current = true;

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
        tl.from(".hc-core", { scale: 0.88, opacity: 0, duration: 0.42, transformOrigin: "210px 190px" })
          .from(".hc-orb", { scale: 0.7, opacity: 0, duration: 0.38, stagger: 0.055, transformOrigin: "center" }, "-=0.22")
          .from(".hc-link", { opacity: 0, duration: 0.3, stagger: 0.05 }, "-=0.34");
        return () => tl.kill();
      });
      return () => mm.revert();
    }, el);

    return () => ctx.revert();
  }, []);

  // Stage gesture: one dash cycle, end frame === start frame.
  React.useEffect(() => {
    if (prevStage.current === stage) return;
    prevStage.current = stage;

    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".hc-link",
        { strokeDashoffset: 0 },
        { strokeDashoffset: -10, duration: 0.32, ease: "power4.inOut", overwrite: "auto" },
      );
    }, el);

    return () => ctx.revert();
  }, [stage]);

  return (
    <svg
      ref={root}
      viewBox="0 0 420 380"
      className="w-full h-auto max-w-[420px]"
      fill="none"
      role="img"
      aria-labelledby="hero-title hero-desc"
    >
      <title id="hero-title">Sorted</title>
      <desc id="hero-desc">
        Four spending buckets (guilt-free, investments, savings and fixed costs) arranged
        around a rupee symbol and joined to it by dotted connector lines.
      </desc>

      {/* Connectors. This exact stroke is reused as the tether elsewhere in the
          product: the mark for "a connection did this, not you." */}
      <g stroke="var(--ink)" strokeWidth="1.6" strokeDasharray="4 6" strokeLinecap="round">
        {LINKS.map((d) => (
          <path key={d} className="hc-link" d={d} />
        ))}
      </g>

      <g className="hc-core">
        <circle cx="210" cy="190" r="64" fill="var(--bg)" stroke="var(--ink)" strokeWidth="4.5" />
        <text
          x="210"
          y="215"
          textAnchor="middle"
          fill="var(--ink)"
          style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 66 }}
        >
          &#8377;
        </text>
      </g>

      <g fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ORBS.map((o) => (
          <g key={o.id} className="hc-orb">
            <title>{o.label}</title>
            <circle cx={o.cx} cy={o.cy} r="30" fill={o.fill} stroke="var(--ink)" strokeWidth="4" />
            <g transform={`translate(${o.cx - 12} ${o.cy - 12})`}>{ICONS[o.id]}</g>
          </g>
        ))}
      </g>
    </svg>
  );
}
