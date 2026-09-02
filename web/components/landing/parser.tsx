"use client";

/**
 * Sorted · the parser
 *
 * Back to ink, and entered through a diagonal. The section's top and bottom
 * edges are a static `clip-path: polygon()` at about three degrees, so the
 * boundary between this section and its neighbours is a cut rather than a rule.
 * That is the licensed replacement for the 1.5px ink hairline the app uses to
 * separate sections: on this page a section boundary is allowed to be a change
 * of colour and a change of shape.
 *
 * THE TETHER. The dotted lead-in that marks a row the Gmail parser filed by
 * itself is the product's signature mark, and its identity is the dot pattern:
 * 1.6px stroke, `dasharray 4 6`, round caps.
 *
 * It is revealed by scaling the SVG from `transform-origin: left`. It is NEVER
 * revealed by animating `strokeDashoffset` against a path-length
 * `strokeDasharray`: that substitution replaces `4 6` with one dash as long as
 * the path, and the tether arrives SOLID. A solid line is not the tether. This
 * is a real shipped-and-fixed defect (`landing-tether-lost-its-dots`), recorded
 * in state, and it is trivially easy to reintroduce.
 *
 * Focus on ink is re-pointed at cream by the `on-ink` scope: recoloured, never
 * removed. See globals.css.
 */

import * as React from "react";

import { gsap, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";
import { BucketChip, Tether } from "./icons";
import { PARSED_ROWS } from "./data";

export function Parser() {
  const rootRef = React.useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      const tl = gsap.timeline({
        defaults: { ease: "power4.out" },
        scrollTrigger: { trigger: root, start: "top 68%", once: true },
      });

      tl.from(".l-parser-say", { y: 40, opacity: 0, duration: 1 }, 0)
        // scaleX from the left edge. The dots survive because the dash pattern
        // is never touched.
        .from(".l-tether-long", { scaleX: 0, duration: 1.25, ease: "power3.out" }, 0.15)
        .from(".l-row", { x: -34, opacity: 0, duration: 0.75, stagger: 0.075 }, 0.55);
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="on-ink relative w-full bg-ink px-22 py-96 text-bg lg:px-44"
      style={{
        // A cut, not a rule. Static: clip-path is never animated here.
        // The negative margins MUST equal the cut depth exactly: the polygon's
        // left edge starts 3.2vw down, so anything less pulls the section up by
        // less than it clips off and a sliver of page ground shows through
        // under the diagonal.
        ["--cut" as string]: "3.2vw",
        clipPath: "polygon(0 var(--cut), 100% 0, 100% 100%, 0 calc(100% - var(--cut)))",
        marginTop: "calc(var(--cut) * -1)",
        marginBottom: "calc(var(--cut) * -1)",
      }}
    >
      <div className="l-parser-say">
        <p className="font-num text-meta uppercase tracking-label ink-micro">
          <span style={{ color: "var(--bucket-fixed)" }}>§</span> 04: where the rows come from
        </p>
        <h2
          className="mt-14 max-w-[16ch] font-disp uppercase"
          style={{ fontSize: "clamp(38px, 8vw, 140px)", lineHeight: 0.84, letterSpacing: "-0.05em" }}
        >
          You never type a transaction.
        </h2>
        <p
          className="ink-prose mt-22 max-w-[52ch] font-sans"
          style={{ fontSize: "clamp(16px, 1.3vw, 22px)", lineHeight: 1.45 }}
        >
          Connect Gmail once. Sorted reads the alerts your bank and your broker already
          send you, pulls out the merchant, the amount and the account, and files the row.
          Anything it cannot place honestly is left uncategorised for you to answer:
          never guessed.
        </p>
      </div>

      {/* the oversized tether, drawn across the section */}
      <div className="relative mt-64 h-24 w-full origin-left overflow-visible">
        <Tether
          className="l-tether-long absolute inset-0 h-24 w-full origin-left"
          stroke="var(--bg)"
        />
      </div>

      <ul className="mt-32">
        {PARSED_ROWS.map((row) => (
          <li
            key={row.merchant}
            className="l-row ink-hair grid grid-cols-[16px_30px_1fr_auto] items-center gap-14 border-b-hair py-18"
          >
            <Tether className="h-[12px] w-[16px]" stroke="var(--bg)" />
            <BucketChip id={row.bucket} size={30} />
            <div className="min-w-0">
              <p className="truncate font-sans text-body-s font-semibold">{row.merchant}</p>
              <p className="ink-micro truncate pt-4 font-num text-micro uppercase tracking-micro">
                {row.source}
              </p>
            </div>
            <p className="money text-[clamp(15px,1.6vw,22px)]">{row.amount}</p>
          </li>
        ))}
      </ul>

      <p className="ink-micro mt-26 font-num text-micro uppercase tracking-micro">
        Dotted lead-in = filed by the inbox parser · last run today 09:12
      </p>
    </section>
  );
}
