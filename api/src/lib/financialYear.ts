/**
 * Indian financial year runs April 1 – March 31. A date in Jan/Feb/Mar
 * belongs to the FY that started the PREVIOUS April, not the FY named
 * after that calendar year. All date math here uses UTC (getUTCMonth/
 * getUTCFullYear), matching how dates are stored/compared everywhere
 * else in this codebase (see e.g. monthlyRollup.worker.ts's own note).
 */
export function financialYearFromDate(date: Date): string {
  const month = date.getUTCMonth(); // 0-indexed: 0=Jan, 3=Apr
  const year = date.getUTCFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}
