import { Landing } from "@/components/landing/landing";

/**
 * The public front door.
 *
 * A server component wrapping one client component: the markup ships in the
 * HTML and is complete on its own, and GSAP only layers scroll choreography on
 * top of it once hydrated. With JavaScript disabled the page is a fully
 * readable, correctly-styled landing page — nothing is hidden behind an
 * animation that never runs.
 */
export default function Home() {
  return <Landing />;
}
