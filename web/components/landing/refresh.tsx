"use client";

/**
 * Sorted · start at the top, then refresh once the fonts land
 *
 * Two jobs, both about the first moment of the page.
 *
 * 1 · SCROLL RESTORATION IS TURNED OFF, AND IT HAS TO BE.
 *
 * Browsers restore the previous scroll offset on reload. On an ordinary
 * document that is a courtesy. On this one it is a bug with teeth: reloading
 * anywhere past the first viewport dropped the visitor into the middle of the
 * pinned sort section — reported as "instead of going to the header it loads at
 * the watch-it-work page".
 *
 * It is worse than landing in the wrong place. The restore happens BEFORE
 * ScrollTrigger builds its pins, so every pin then measures its start and end
 * against a document that is already scrolled, and the pin-spacers are inserted
 * underneath a viewport that is looking at the wrong offset. The result is a
 * page that is both in the wrong position and mis-measured, which is why it
 * also felt jumpy.
 *
 * So: `history.scrollRestoration = "manual"` and an explicit scroll to the top,
 * in a LAYOUT effect — before paint, and before the section effects create a
 * single ScrollTrigger. A `useEffect` here would be too late; the restore would
 * already have been painted and the pins already measured.
 *
 * A real in-page anchor (`/#something`) is left alone: jumping to the top would
 * break a deep link, and that is a deliberate destination rather than a
 * restored accident.
 *
 * 2 · ONE REFRESH AFTER THE FONTS SWAP.
 *
 * Bricolage Grotesque 800 at 186px is a very different width from the system
 * fallback it swaps out of, and three pinned ScrollTriggers measure from
 * layout. ScrollTrigger auto-refreshes on resize but not on a font swap, so a
 * single refresh once `document.fonts.ready` resolves is what stops the pins
 * landing a few hundred pixels off on a cold cache.
 *
 * Renders nothing.
 */

import * as React from "react";

import { ScrollTrigger } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";

export function RefreshOnFonts() {
  // Before paint: kill the restore and go to the top.
  useIsoLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const previous = window.history.scrollRestoration;
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      // Safari private mode and a few embedded webviews refuse the setter.
      // Nothing below depends on it having worked.
    }

    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }

    return () => {
      try {
        window.history.scrollRestoration = previous ?? "auto";
      } catch {
        /* see above */
      }
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) ScrollTrigger.refresh();
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(refresh);
    } else {
      refresh();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
