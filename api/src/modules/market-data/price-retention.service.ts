import { PriceSnapshot } from "../../models/PriceSnapshot.js";

const RETENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bounds `PriceSnapshot` collection growth (see the design doc's "Bounded growth" note):
 * snapshots older than 7 days are collapsed down to one per symbol per UTC calendar day
 * (the latest-fetched snapshot that day), with the rest deleted. Snapshots within the last
 * 7 days are left completely untouched, preserving full resolution for recent charts.
 *
 * "Calendar day" is computed from the UTC date (`toISOString().slice(0, 10)`), matching the
 * UTC-consistent date treatment used elsewhere in this codebase (see monthlyRollup.worker.ts's
 * `previousMonthString` doc comment): a snapshot at 23:55 UTC and one at 00:05 UTC the next
 * day are 10 minutes apart but land in different day-buckets and are NOT collapsed together.
 *
 * The 7-day cutoff uses a strict `$lt`: a snapshot exactly 7 days old (to the millisecond) is
 * treated as still within the retention window and left alone, not rolled up.
 *
 * Idempotent: once a day-bucket has been reduced to a single snapshot, running this again
 * finds nothing else to delete for that bucket (the "keep" survivor is the only old snapshot
 * left for that symbol+day, so it is neither deleted nor duplicated).
 */
export async function rollupOldPriceSnapshots(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);

  const oldSnapshots = await PriceSnapshot.find({ fetchedAt: { $lt: cutoff } })
    .sort({ fetchedAt: 1 })
    .lean();

  // Sorted ascending by fetchedAt, so for each symbol+day bucket the last write wins,
  // meaning keepIdBySymbolDay ends up holding the LATEST snapshot's _id per bucket.
  const keepIdBySymbolDay = new Map<string, string>();
  for (const snapshot of oldSnapshots) {
    const dayKey = `${snapshot.symbol}:${snapshot.fetchedAt.toISOString().slice(0, 10)}`;
    keepIdBySymbolDay.set(dayKey, snapshot._id.toString());
  }

  const idsToKeep = new Set(keepIdBySymbolDay.values());
  const idsToDelete = oldSnapshots.filter((s) => !idsToKeep.has(s._id.toString())).map((s) => s._id);

  if (idsToDelete.length > 0) {
    await PriceSnapshot.deleteMany({ _id: { $in: idsToDelete } });
  }
}
