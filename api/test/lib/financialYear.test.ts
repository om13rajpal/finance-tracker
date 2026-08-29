import { describe, it, expect } from "vitest";
import { financialYearFromDate } from "../../src/lib/financialYear.js";

describe("financialYearFromDate", () => {
  it("a date in April belongs to the FY starting that April", () => {
    expect(financialYearFromDate(new Date("2025-04-01T00:00:00Z"))).toBe("2025-26");
  });

  it("a date in December belongs to the FY that started the previous April", () => {
    expect(financialYearFromDate(new Date("2025-12-25T00:00:00Z"))).toBe("2025-26");
  });

  it("a date in January/February/March belongs to the FY that started the previous April", () => {
    expect(financialYearFromDate(new Date("2026-03-31T00:00:00Z"))).toBe("2025-26");
  });

  it("a date exactly on the FY boundary (April 1) belongs to the new FY", () => {
    expect(financialYearFromDate(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
  });

  it("a date the day before the boundary (March 31) belongs to the old FY", () => {
    expect(financialYearFromDate(new Date("2026-03-31T23:59:59Z"))).toBe("2025-26");
  });
});
