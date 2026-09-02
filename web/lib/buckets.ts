/**
 * Sorted · the four-bucket taxonomy
 *
 * THE LOCKED RULE: colour is for the CLOSED set; language is for the unbounded
 * one.
 *
 * Categories in this product are a user-defined TREE of arbitrary depth with
 * arbitrary names, created at runtime. A fixed palette cannot colour an
 * unbounded set without inventing an assignment: an invented assignment is
 * a chip that guesses. Buckets, by contrast, are fixed in the API's own type:
 * `fixed_costs | investments | savings | guilt_free`. Four values, forever.
 *
 * So the CHIP carries the bucket, and the category name carries in TEXT.
 *
 * The payoff is that the colour system now points at the number the whole
 * product is built around: `guilt_free` is exactly where the dashboard's
 * Guilt-Free Money figure comes from.
 *
 * MEASURED: ink on all four fills is 8.10 / 6.50 / 4.61 / 9.80 : 1. Every
 * bucket is textSafe. The retired six-category set never was (shopping 3.32,
 * health 3.46), and two of its chips sat 9° apart in hue. Fewer chips is
 * strictly more robust here, not a compromise.
 *
 * CHIPS NEVER GUESS. A row whose bucket is not knowable never gets a filled
 * chip: see `resolveChip` below.
 */

export type Bucket = "fixed_costs" | "investments" | "savings" | "guilt_free";

export type CategoryType = "expense" | "income";

/** The API's category tree node. `children` is always present, possibly empty. */
export interface CategoryNode {
  _id: string;
  name: string;
  type: CategoryType;
  bucket: Bucket;
  budgetLimit: number;
  children: CategoryNode[];
}

export const BUCKETS: readonly Bucket[] = [
  "fixed_costs",
  "investments",
  "savings",
  "guilt_free",
] as const;

export interface BucketMeta {
  /** What a person reads. NEVER render the raw enum key in the UI. */
  label: string;
  /** Tailwind background utility, resolving to the token. */
  fill: string;
  /** The bucket's own icon id in the sprite. Always drawn: never omitted. */
  icon: "b-fixed" | "b-invest" | "b-savings" | "b-guiltfree";
  /** One line explaining what belongs in it, for the legend and the picker. */
  hint: string;
}

export const BUCKET_META: Record<Bucket, BucketMeta> = {
  fixed_costs: {
    label: "Fixed costs",
    fill: "bg-bucket-fixed",
    icon: "b-fixed",
    hint: "Rent, bills, EMIs: the money that leaves whether you think about it or not.",
  },
  investments: {
    label: "Investments",
    fill: "bg-bucket-invest",
    icon: "b-invest",
    hint: "SIPs, stocks, PPF: money moved rather than spent.",
  },
  savings: {
    label: "Savings",
    fill: "bg-bucket-savings",
    icon: "b-savings",
    hint: "Set aside for something named. Emergency fund, a goal, a big buy.",
  },
  guilt_free: {
    label: "Guilt-free",
    fill: "bg-bucket-guiltfree",
    icon: "b-guiltfree",
    hint: "What is left once everything above is paid. Spend it without thinking.",
  },
};

/** The bucket labels, for a `<select>` where the raw enum must never appear. */
export const BUCKET_OPTIONS = BUCKETS.map((b) => ({ value: b, label: BUCKET_META[b].label }));

/** Guards a value that arrived from the API or a form. */
export function isBucket(value: unknown): value is Bucket {
  return typeof value === "string" && (BUCKETS as readonly string[]).includes(value);
}

/** A person-readable bucket name, safe on an unknown value. */
export function bucketLabel(value: unknown): string {
  return isBucket(value) ? BUCKET_META[value].label : "Unsorted";
}

// ───────────────────────────────────────────────────────────────────────────
// The category index
// ───────────────────────────────────────────────────────────────────────────

export interface IndexedCategory {
  node: CategoryNode;
  depth: number;
  /** The parent node, or null at the top level. */
  parent: CategoryNode | null;
  /** Root → leaf, inclusive. Used to disambiguate a leaf name when it repeats. */
  path: CategoryNode[];
  /**
   * The bucket this category answers to.
   *
   * Taken from the node itself, falling back to the nearest ancestor that has
   * one. Every leaf therefore inherits its ancestor's bucket, which is what
   * makes the chip answerable at ANY depth of a tree the user can nest as far
   * as they like.
   */
  bucket: Bucket | null;
}

export type CategoryIndex = Map<string, IndexedCategory>;

/** Walks the tree once and indexes every node by id. */
export function indexCategories(tree: CategoryNode[] | undefined): CategoryIndex {
  const index: CategoryIndex = new Map();

  const walk = (
    nodes: CategoryNode[],
    depth: number,
    parent: CategoryNode | null,
    path: CategoryNode[],
    inherited: Bucket | null
  ) => {
    for (const node of nodes) {
      const bucket = isBucket(node.bucket) ? node.bucket : inherited;
      const nextPath = [...path, node];
      index.set(node._id, { node, depth, parent, path: nextPath, bucket });
      walk(node.children ?? [], depth + 1, node, nextPath, bucket);
    }
  };

  walk(tree ?? [], 0, null, [], null);
  return index;
}

/** Depth-first, parents before children: the order a `<select>` should list. */
export function flattenCategories(
  tree: CategoryNode[] | undefined,
  depth = 0
): { node: CategoryNode; depth: number }[] {
  return (tree ?? []).flatMap((node) => [
    { node, depth },
    ...flattenCategories(node.children ?? [], depth + 1),
  ]);
}

/**
 * How a category should be NAMED in a dense row.
 *
 * The leaf carries. The parent is prepended only when it genuinely
 * disambiguates: never a full breadcrumb, which would push the amount column
 * around on every row.
 */
export function categoryRowName(entry: IndexedCategory | undefined, index: CategoryIndex): string {
  if (!entry) return "Uncategorised";
  if (!entry.parent) return entry.node.name;

  // Ambiguous only if some OTHER category shares this leaf name.
  let duplicated = false;
  for (const other of index.values()) {
    if (other.node._id !== entry.node._id && other.node.name === entry.node.name) {
      duplicated = true;
      break;
    }
  }
  return duplicated ? `${entry.parent.name} › ${entry.node.name}` : entry.node.name;
}

// ───────────────────────────────────────────────────────────────────────────
// The chip decision: the single place "chips never guess" is enforced
// ───────────────────────────────────────────────────────────────────────────

export type ChipSpec =
  /** A knowable destination. Filled with the bucket colour, carrying its icon. */
  | { kind: "bucket"; bucket: Bucket }
  /**
   * Money arriving. `type: "income"` has no destination bucket at all, so it
   * gets a hollow chip with a solid ink stroke and an up arrow: the same
   * vocabulary the dashboard already uses for RecurringItem, which carries no
   * category field either.
   */
  | { kind: "income" }
  /** Money leaving, direction known but destination not. Hollow, down arrow. */
  | { kind: "expense" }
  /**
   * `categoryId` is null. This is the Gmail parser's NORMAL output, not an
   * error, so it is drawn as an actionable gap (dashed hollow chip, question
   * glyph) and never in --alert.
   */
  | { kind: "uncategorised" };

/**
 * The one function that decides what chip a row gets.
 *
 * Everything that renders a row goes through here, so the rule cannot drift
 * screen by screen.
 */
export function resolveChip(
  categoryId: string | null | undefined,
  index: CategoryIndex,
  fallback?: { direction?: "income" | "expense" }
): ChipSpec {
  if (categoryId) {
    const entry = index.get(categoryId);
    if (entry?.node.type === "income") return { kind: "income" };
    if (entry?.bucket) return { kind: "bucket", bucket: entry.bucket };
    // A real category we cannot place. Still never guessed at.
    if (entry) return { kind: "uncategorised" };
  }
  if (fallback?.direction === "income") return { kind: "income" };
  if (fallback?.direction === "expense") return { kind: "expense" };
  return { kind: "uncategorised" };
}

/** The accessible name for a chip, so a screen reader gets the taxonomy too. */
export function chipLabel(spec: ChipSpec): string {
  switch (spec.kind) {
    case "bucket":
      return BUCKET_META[spec.bucket].label;
    case "income":
      return "Money in";
    case "expense":
      return "Money out";
    case "uncategorised":
      return "Not categorised yet";
  }
}
