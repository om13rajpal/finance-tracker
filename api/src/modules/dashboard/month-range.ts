/**
 * Computes the [start, end) UTC boundaries for a "YYYY-MM" month string.
 *
 * Uses UTC explicitly rather than the host process's local timezone, matching the
 * UTC-consistent date treatment already established elsewhere in this codebase (see
 * `recurring.service.ts`'s `addMonthsClamped`, which is UTC throughout because dates
 * coming out of Mongo and off `new Date("YYYY-MM-DD")` literals are UTC-midnight).
 * Using local-time month boundaries here would make "this month" shift depending on
 * where the API process happens to be deployed/run, silently including or excluding
 * transactions near a month boundary.
 */
export function monthRangeUtc(month: string): { start: Date; end: Date } {
  const [year, monthNum] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 1));
  return { start, end };
}
