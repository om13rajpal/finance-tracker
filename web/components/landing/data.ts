/**
 * Sorted · landing page content
 *
 * Every merchant, amount and timestamp on this page is real-shaped: Indian
 * merchants that actually bill Indian accounts, amounts with paise where paise
 * genuinely occur (utilities) and none where they don't (a cinema ticket), and
 * bank/broker provenance on every row because that is where the rows come from.
 *
 * The twelve SORT rows are the centrepiece of the page, so they are also the
 * one dataset that has to survive arithmetic: the four lane totals below are
 * the exact sums of their rows. If you edit a row, edit the total.
 *
 *   fixed      2,847.50 + 1,099.50 + 42,000  = 45,947
 *   invest       25,000 +   15,000 +  5,000  = 45,000
 *   savings      10,000 +    7,500           = 17,500
 *   guiltfree       487 +    1,204 + 388 + 940 = 3,019
 */

export type BucketId = "fixed" | "invest" | "savings" | "guiltfree";

export const BUCKET_ORDER: readonly BucketId[] = ["fixed", "invest", "savings", "guiltfree"] as const;

/** `var(--bucket-*)`. Never a hex: `web/` carries zero hardcoded colour. */
export const bucketVar = (id: BucketId) => `var(--bucket-${id})`;

export interface BucketMeta {
  id: BucketId;
  /**
   * The API's literal `CategoryNode.bucket` value. NEVER RENDERED: every
   * visitor-facing label on the page reads `name`. This field exists so the
   * page's data speaks the same identifiers as the product behind the login;
   * printing it would put `GUILT_FREE`, underscore and all, on screen.
   */
  key: string;
  name: string;
  blurb: string;
  /**
   * A MONTH, not the demo week. The sort stage above shows one week of twelve
   * rows and its lane totals are that week's sums; these are the month.
   *
   * GUILT-FREE DELIBERATELY HAS NO FIGURE, and this is not an oversight.
   * ₹18,240 is the entire job of the payoff section immediately below, where it
   * is set at clamp(64px, 22vw, 340px). On a phone the fourth room's foot and
   * that figure sit in one viewport, and two printings of one number a screen
   * apart read as a duplication bug: the worse for the payoff figure being
   * mid-scramble at that moment, so the two disagree by a rupee. The room hands
   * the number on instead.
   *
   * The hero also prints ₹18,240, and that is fine: it is ten viewports up and
   * the two can never share a screen. The rule this enforces is CO-VISIBILITY,
   * not a global count: the hero states the figure as a claim, the payoff
   * arrives at it having shown the sort. Promise, then proof. Two printings
   * within one screen of each other is the bug; two a page apart is structure.
   */
  figure?: string;
  figureLabel?: string;
  /** What closes a column that has no figure. Mono, in the figure's slot. */
  foot?: string;
  /**
   * This bucket's share of the month, as a percentage of MONTH_TOTAL.
   *
   * LOAD-BEARING, NOT DECORATIVE. The section is a single bar whose segment
   * widths are these numbers, and its entire argument is "drawn to scale", so
   * an approximation is not a rounding, it is a lie about the one thing the
   * section claims. They are computed below from the figures rather than typed,
   * so editing a figure cannot silently desync the picture from the data.
   */
  share: number;
}

/** The four figures, in paise-free rupees, as the bar's denominator. */
const MONTH = { fixed: 64900, invest: 45000, savings: 17500, guiltfree: 18240 } as const;
export const MONTH_TOTAL = Object.values(MONTH).reduce((a, b) => a + b, 0); // 1,45,640
const shareOf = (id: keyof typeof MONTH) => (MONTH[id] / MONTH_TOTAL) * 100;

/**
 * INK-ON-FILL CONTRAST. Measured during the taxonomy work, kept here as the
 * standing justification for a rule this page breaks on purpose:
 *
 *   fixed 8.10:1 · invest 6.50:1 · savings 4.61:1 · guilt-free 9.80:1
 *
 * All four carry ink type safely, which is what licenses a bucket colour to own
 * an entire viewport in the rooms rather than appearing as one small accent
 * block. Inside the product the one-accent-block rule still holds, because
 * there the colour sits beside live numbers; on this page there are none.
 *
 * These ratios are engineering rationale, not copy. They were once printed in
 * each room's corner; a visitor to a finance product has no use for the
 * contrast ratio of the panel they are standing on. Keep them in the source.
 */
export const BUCKETS: readonly BucketMeta[] = [
  {
    id: "fixed",
    key: "fixed_costs",
    name: "Fixed costs",
    blurb: "Rent, electricity, the fibre bill, the subscriptions you forgot about. Money that leaves whether you look or not.",
    figure: "₹64,900",
    figureLabel: "this month",
    share: shareOf("fixed"),
  },
  {
    id: "invest",
    key: "investments",
    name: "Investments",
    blurb: "SIPs, index funds, NPS. Tracked on real FIFO cost basis, so the gain you see is the gain you'll be taxed on.",
    figure: "₹45,000",
    figureLabel: "this month",
    share: shareOf("invest"),
  },
  {
    id: "savings",
    key: "savings",
    name: "Savings",
    blurb: "Money with a job it hasn't started yet. Recurring deposits, the emergency fund, whatever the goal is.",
    figure: "₹17,500",
    figureLabel: "this month",
    share: shareOf("savings"),
  },
  {
    id: "guiltfree",
    key: "guilt_free",
    name: "Guilt-free",
    blurb: "What is left once everything that matters is handled. Spend it. That is the entire point of the other three.",
    foot: "just below",
    share: shareOf("guiltfree"),
  },
] as const;

export interface SortRow {
  merchant: string;
  /** Where the row came from. The parser reads these, nobody types them. */
  source: string;
  amount: string;
  /** Numeric, for the lane counters. Negative amounts are shown with a minus
   *  in `amount`; the counter counts the magnitude, which is what a lane is. */
  value: number;
  bucket: BucketId;
}

/**
 * Twelve transactions in the order they landed: deliberately interleaved, so
 * the stack really does have to be sorted rather than sliced.
 */
export const SORT_ROWS: readonly SortRow[] = [
  { merchant: "Swiggy Instamart", source: "HDFC alert · Tue 11:40 PM", amount: "−₹487", value: 487, bucket: "guiltfree" },
  { merchant: "BSES Rajdhani", source: "HDFC alert · Mon 09:12", amount: "−₹2,847.50", value: 2847.5, bucket: "fixed" },
  { merchant: "Parag Parikh Flexi Cap", source: "Zerodha · SIP", amount: "−₹25,000", value: 25000, bucket: "invest" },
  { merchant: "HDFC recurring deposit", source: "HDFC alert · 1st", amount: "−₹10,000", value: 10000, bucket: "savings" },
  { merchant: "Blinkit", source: "ICICI alert · yesterday", amount: "−₹1,204", value: 1204, bucket: "guiltfree" },
  { merchant: "Airtel Fibre", source: "ICICI alert · Sat 07:03", amount: "−₹1,099.50", value: 1099.5, bucket: "fixed" },
  { merchant: "Nifty 50 Index", source: "Zerodha · SIP", amount: "−₹15,000", value: 15000, bucket: "invest" },
  { merchant: "Third Wave Coffee", source: "HDFC alert · Fri 8:41 AM", amount: "−₹388", value: 388, bucket: "guiltfree" },
  { merchant: "Prestige Falcon City", source: "HDFC alert · 5th, rent", amount: "−₹42,000", value: 42000, bucket: "fixed" },
  { merchant: "Emergency fund", source: "ICICI alert · standing instruction", amount: "−₹7,500", value: 7500, bucket: "savings" },
  { merchant: "NPS Tier I", source: "Groww · monthly", amount: "−₹5,000", value: 5000, bucket: "invest" },
  { merchant: "BookMyShow · PVR Orion", source: "HDFC alert · Sun 6:20 PM", amount: "−₹940", value: 940, bucket: "guiltfree" },
] as const;

export interface LaneMeta {
  id: BucketId;
  /** The lane header a visitor reads. `BucketMeta.name`, never `.key`. */
  label: string;
  rows: SortRow[];
  total: number;
  totalLabel: string;
  /**
   * How high the colour rises in the lane, 0–1. PRE-COMPUTED ON PURPOSE.
   * The fill is a `scaleY` on a colour layer with `transform-origin: bottom`,
   * driven straight off this constant, so the scrub never reads layout, never
   * animates a height, and never thrashes. Tuned as rowCount / 4 × 0.78 so the
   * level always sits well above the top row in its lane, which reads as a
   * liquid level rather than a bar chart.
   */
  fill: number;
}

const laneOf = (id: BucketId) => SORT_ROWS.filter((r) => r.bucket === id);

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Every rupee figure on this page goes through en-IN, so the grouping is
 *  lakh/crore (1,24,750) and not the thousands grouping (124,750). */
export const formatINR = (n: number) => inr0.format(Math.round(n));

export const LANES: readonly LaneMeta[] = BUCKET_ORDER.map((id) => {
  const rows = laneOf(id);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return {
    id,
    label: BUCKETS.find((b) => b.id === id)!.name,
    rows,
    total,
    totalLabel: formatINR(total),
    fill: (rows.length / 4) * 0.78,
  };
});

/**
 * The raw unsorted feed. Flattened into the hero board, and what arrives before
 * anything has been decided about it: merchant, amount, nothing else.
 */
export const TICKER: readonly { text: string; bucket: BucketId }[] = [
  { text: "Swiggy Instamart −₹487", bucket: "guiltfree" },
  { text: "BSES Rajdhani −₹2,847.50", bucket: "fixed" },
  { text: "Parag Parikh Flexi Cap −₹25,000", bucket: "invest" },
  { text: "HDFC recurring deposit −₹10,000", bucket: "savings" },
  { text: "Blinkit −₹1,204", bucket: "guiltfree" },
  { text: "Airtel Fibre −₹1,099.50", bucket: "fixed" },
  { text: "Nifty 50 Index −₹15,000", bucket: "invest" },
  { text: "Third Wave Coffee −₹388", bucket: "guiltfree" },
  { text: "Prestige Falcon City −₹42,000", bucket: "fixed" },
  { text: "Emergency fund −₹7,500", bucket: "savings" },
  { text: "NPS Tier I −₹5,000", bucket: "invest" },
  { text: "BookMyShow · PVR Orion −₹940", bucket: "guiltfree" },
  { text: "Zepto −₹643.75", bucket: "guiltfree" },
  { text: "Cred · HDFC Millennia 4218 −₹18,406.12", bucket: "fixed" },
  { text: "Groww · ELSS −₹12,500", bucket: "invest" },
  { text: "Urban Company −₹1,499", bucket: "guiltfree" },
] as const;

/** Rows the Gmail parser filed by itself: the tether's home. */
export const PARSED_ROWS: readonly { merchant: string; source: string; amount: string; bucket: BucketId }[] = [
  { merchant: "BSES Rajdhani", source: "HDFC · debit alert · Mon 09:12", amount: "−₹2,847.50", bucket: "fixed" },
  { merchant: "Parag Parikh Flexi Cap", source: "Zerodha · order executed · Mon 15:31", amount: "−₹25,000", bucket: "invest" },
  { merchant: "Swiggy Instamart", source: "HDFC · UPI · Tue 11:40 PM", amount: "−₹487", bucket: "guiltfree" },
  { merchant: "Emergency fund", source: "ICICI · standing instruction · Wed 00:04", amount: "−₹7,500", bucket: "savings" },
] as const;

/**
 * SIX ROWS NEED SIX COLOURS, AND THERE ARE ONLY FOUR BUCKETS.
 *
 * Colouring each row by the bucket it serves meant two hues appearing twice,
 * which reads as the palette running out. Flooding every row with ink instead
 * fixed the repeat by removing the colour, which reads as no palette at all.
 * Both were rejected on sight, and both were the same mistake: treating six
 * rows as if they had to be derived from four buckets.
 *
 * They do not. These rows are capabilities, not transactions: nothing here is
 * a bucket, so nothing here owes the bucket palette anything. What they owe is
 * the PRODUCT's palette, and that has two more saturated hues than the bucket
 * set uses: `#8A4BD1` and `#C43C63`, the two chips retired when the taxonomy
 * collapsed from six categories to four buckets.
 *
 * They were retired for one specific reason: ink on them measures 3.32:1 and
 * 3.46:1, so a rupee figure could not be set inside them. That constraint does
 * not travel: nothing on this page sets ink inside these two. They carry cream
 * instead, at 5.42:1 and 5.21:1, which is comfortably past AA for the display
 * sizes here. So the page gets six genuinely distinct colours, every one of
 * them already a Sorted colour, and none of them invented for a landing page.
 *
 * `on` is per row rather than global because these six do not share a text
 * colour: four take ink, two take cream. Stating it as data is what stops a
 * future edit from reordering the list and silently dropping a row to 3.3:1.
 */
export interface Capability {
  title: string;
  detail: string;
  bucket: BucketId;
  /** Row flood colour. Six distinct values; never derived from `bucket`. */
  accent: string;
  /** Type colour ON that flood. Measured, not guessed: see the note above. */
  on: string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    title: "Net worth",
    detail: "Every account and every holding, rolled into one number that is actually current.",
    bucket: "savings",
    accent: "var(--bucket-savings)",
    on: "var(--ink)",
  },
  {
    title: "FIFO cost basis",
    detail: "Lot-by-lot accounting, not a running average. Your gain is the gain you'll be taxed on.",
    bucket: "invest",
    accent: "var(--bucket-invest)",
    on: "var(--ink)",
  },
  {
    title: "Indian tax",
    detail: "STCG and LTCG classified as they happen. 80C tracked from your own PPF and ELSS.",
    bucket: "invest",
    accent: "var(--cap-violet)",
    on: "var(--bg)",
  },
  {
    title: "Recurring",
    detail: "Rent, SIPs, subscriptions. Knows what is due in the next thirty days before it leaves.",
    bucket: "fixed",
    accent: "var(--bucket-fixed)",
    on: "var(--ink)",
  },
  {
    title: "Budgets",
    detail: "Per-category limits that roll up to the bucket, and say so out loud when you cross one.",
    bucket: "fixed",
    accent: "var(--cap-crimson)",
    on: "var(--bg)",
  },
  {
    title: "Goals",
    detail: "What you are saving toward, and whether this month actually moved it.",
    bucket: "guiltfree",
    accent: "var(--bucket-guiltfree)",
    on: "var(--ink)",
  },
] as const;

/**
 * The payoff figure. Illustrative: see the rule-12 note in guilt-free.tsx.
 */
/**
 * THE BOARD: the hero's ground.
 *
 * A departure-board grid of single characters, built by flattening the real
 * ticker feed. Nothing here is decoration: every glyph on screen is a character
 * of a merchant a bank actually billed, or of the amount it billed.
 *
 * DETERMINISTIC ON PURPOSE: no `Math.random()` anywhere in this module.
 * The board is rendered on the server and hydrated on the client, so a random
 * fill would produce two different character sets and React would throw a
 * hydration mismatch on every load. The flicker is applied AFTER mount, by
 * GSAP, where randomness is free. The initial frame must be reproducible.
 *
 * A cell carries a bucket only where a merchant name starts, so colour lands
 * on the first letter of "BSES" or "NPS" rather than scattering at random:
 * sparse, and tied to something true.
 */
const BOARD_SOURCE = TICKER.map((t) => t.text.toUpperCase()).join("   ·   ");

export interface BoardCell {
  ch: string;
  bucket: BucketId | null;
}

export const BOARD_CELLS: readonly BoardCell[] = (() => {
  // Index of every character that begins one of the ticker entries, so the
  // colour accents fall on real word-starts.
  const starts = new Set<number>();
  let cursor = 0;
  for (const entry of TICKER) {
    starts.add(cursor);
    cursor += entry.text.length + 5; // + the "   ·   " joiner
  }
  const bucketAt = (i: number) => {
    let c = 0;
    for (const entry of TICKER) {
      if (c === i) return entry.bucket;
      c += entry.text.length + 5;
    }
    return null;
  };

  const out: BoardCell[] = [];
  // 420 cells. Enough to fill a tall viewport AND to keep the board dense:
  // a sparse grid reads as a texture that failed, not as a board at rest.
  for (let i = 0; i < 420; i++) {
    const src = i % BOARD_SOURCE.length;
    const ch = BOARD_SOURCE[src];
    out.push({ ch: ch === " " ? "·" : ch, bucket: starts.has(src) ? bucketAt(src) : null });
  }
  return out;
})();

/** The pool the flicker draws replacement glyphs from. Digits and the rupee
 *  sign dominate, because this is a board about money, not an alphabet. */
export const BOARD_GLYPHS = "0123456789₹0123456789·ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const GUILT_FREE_FIGURE = 18240;
export const GUILT_FREE_LABEL = formatINR(GUILT_FREE_FIGURE);
