import { describe, it, expect } from "vitest";
import { parseHdfcDebitAlert } from "../../src/modules/email-ingestion/parsers/hdfc.parser.js";

describe("parseHdfcDebitAlert", () => {
  it("parses amount/merchant/date as before when there is no balance figure in the email", () => {
    const parsed = parseHdfcDebitAlert("Rs.499.00 debited from account XX1234 to SWIGGY on 15-08-26", "Debit Alert");
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe(-499);
    expect(parsed!.merchant).toBe("SWIGGY");
    expect(parsed!.date).toBe("2026-08-15");
    expect(parsed!.availableBalance).toBeUndefined();
  });

  it("captures the embedded 'Avl Bal' figure when present", () => {
    const parsed = parseHdfcDebitAlert(
      "Rs.499.00 debited from account XX1234 to SWIGGY on 15-08-26. Avl Bal: Rs.12,345.67",
      "Debit Alert"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.availableBalance).toBe(12345.67);
  });

  it("handles 'Avl bal INR 10,000.00' phrasing (no colon, INR instead of Rs.)", () => {
    const parsed = parseHdfcDebitAlert(
      "Rs.100.00 debited from account XX1234 to ZOMATO on 01-01-26 Avl bal INR 10,000.00",
      "Debit Alert"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.availableBalance).toBe(10000);
  });

  it("handles the abbreviated 'Avl.Bal.' phrasing with no thousands separator", () => {
    const parsed = parseHdfcDebitAlert(
      "Rs.50.00 debited from account XX1234 to CHAI on 02-02-26. Avl.Bal.:Rs.999.50",
      "Debit Alert"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.availableBalance).toBe(999.5);
  });

  it("still returns null for a body that doesn't match the debit-alert shape at all", () => {
    expect(parseHdfcDebitAlert("Your OTP is 123456", "OTP")).toBeNull();
  });
});
