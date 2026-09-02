import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanMerchantLabel, cleanMerchantLabelSmart } from "../../src/lib/merchant-cleanup.js";
import { cleanMerchantLabelWithLlm } from "../../src/lib/merchant-llm-cleanup.js";

vi.mock("../../src/lib/merchant-llm-cleanup.js", () => ({
  cleanMerchantLabelWithLlm: vi.fn(),
}));

// These narration shapes mirror real HDFC/SBI statement text observed while
// validating this app against real (redacted here) bank exports. Reference
// numbers, VPA handles, and names below are synthetic stand-ins, not real
// account data, but the surrounding punctuation/structure is unchanged.
describe("cleanMerchantLabel", () => {
  describe("known merchants: matched anywhere in the narration", () => {
    it("extracts Netflix from a slash-delimited UPI debit narration", () => {
      expect(
        cleanMerchantLabel("UPI/DR/103523751353/NETFLIX/HDFC/netflix.bd/Execu 0097691162095 AT 00652 MAIN BRANCH , HISAR")
      ).toBe("Netflix");
    });

    it("extracts Spotify from a UPI/billdesk narration", () => {
      expect(cleanMerchantLabel("UPI/DR/127653215987/SPOTIFY/HDFC/billdeskpg/Pay 0097696162090 AT 00652 MAIN BRANCH")).toBe(
        "Spotify"
      );
    });

    it("extracts JioHotstar from a UPI narration", () => {
      expect(cleanMerchantLabel("UPI/DR/616058825061/JioHotstar/YESB/hotstaronl/Co 0097691162095 AT 00652 MAIN BRANCH")).toBe(
        "JioHotstar"
      );
    });

    it("extracts Google Play from a POS-style narration with a leading timestamp", () => {
      expect(cleanMerchantLabel("3:41 MOUNTAIN VIEW GOOGLE *PLAY")).toBe("Google Play");
    });

    it("extracts Dominos from a hyphen-delimited UPI narration with a payment-gateway suffix", () => {
      expect(
        cleanMerchantLabel(
          "0PTMUPI-617123446765-UPI UPI-DOMINOSPIZZA-JUBILANTFOODWORKSLIMI.PAYU@AIRTEL-AIRP0000001-617271056266-UPI"
        )
      ).toBe("Dominos");
    });

    it("extracts Zepto from an INTENT-prefixed UPI narration", () => {
      expect(cleanMerchantLabel("INTENT UPI-ZEPTO-ZEPTO.PAYU@HDFCBANK-HDFC0MERUP")).toBe("Zepto");
    });

    it("extracts Swiggy when the merchant name appears BEFORE the UPI marker", () => {
      expect(cleanMerchantLabel("P0000011-653601178007-SWIGGY UPI-XXXXXXX7543-SBIN0000652-653753185676")).toBe("Swiggy");
    });

    it("is case-insensitive", () => {
      expect(cleanMerchantLabel("upi/dr/123456789012/amazon/hdfc/amazonpay/")).toBe("Amazon");
    });
  });

  describe("structural transaction-type patterns", () => {
    it("labels an ATM withdrawal with a trailing city", () => {
      expect(cleanMerchantLabel("ATW-531209XXXXXX8884-P3DCPA09-PATIALA")).toBe("ATM Withdrawal · Patiala");
    });

    it("labels a bare ATM withdrawal with no trailing city", () => {
      expect(cleanMerchantLabel("ATW-531209XXXXXX8884-P3DCPA09")).toBe("ATM Withdrawal");
    });

    it("labels a cheque deposit", () => {
      expect(cleanMerchantLabel("CHQ DEP - CTS CLG1 - HISAR JINDAL CHOWK")).toBe("Cheque Deposit");
    });

    it("labels a debit card issuance fee", () => {
      expect(cleanMerchantLabel("DEBIT CARD ISSUANCE FEE-EPR2709729186519")).toBe("Debit Card Issuance Fee");
    });

    it("labels interest credit", () => {
      expect(cleanMerchantLabel("INTEREST CREDIT")).toBe("Interest Credit");
    });

    it("labels an ATM cash withdrawal commission line", () => {
      expect(cleanMerchantLabel("CASH WDL COMM CHG-EPR1234567890123")).toBe("ATM Cash Withdrawal Commission");
    });

    it("labels an ATM cash withdrawal service charge line", () => {
      expect(cleanMerchantLabel("CASH WDL SERV CHG-EPR1234567890124")).toBe("ATM Cash Withdrawal Service Charge");
    });

    it("labels a NEFT transfer with a trailing name", () => {
      expect(cleanMerchantLabel("NEFT*HDFC0000241234567890-ACME EXPORTS PVT LTD")).toBe("NEFT · Acme Exports Pvt Ltd");
    });

    it("falls back to a generic NEFT label with no readable trailing name", () => {
      expect(cleanMerchantLabel("NEFT*HDFC0000241234567890-1234567890")).toBe("NEFT Transfer");
    });

    it("labels an IMPS transfer", () => {
      expect(cleanMerchantLabel("IMPS-123456789012-JOHN DOE-SBIN0001234-9876543210-Rent")).toBe("IMPS · John Doe");
    });
  });

  describe("generic UPI extraction (no known-merchant match)", () => {
    it("extracts a person's name from a self-transfer style UPI narration", () => {
      expect(cleanMerchantLabel("UPI-JANE DOE-JANEDOE99887@OKSBI-SBIN0001234-UPI")).toBe("Jane Doe");
    });

    it("extracts a small merchant name from a UPI narration", () => {
      expect(cleanMerchantLabel("61812 UPI-SALON X-SALONX.42913337@HDFCBANK-HDF")).toBe("Salon X");
    });
  });

  describe("generic fallback (no pattern matches at all)", () => {
    it("strips a VPA handle and title-cases what's left", () => {
      expect(cleanMerchantLabel("PAYMENT TO SOME RANDOM SHOP randomshop@oksbi")).toBe("Payment To Some Random Shop");
    });

    it("never returns something worse than the input for unrecognized text", () => {
      const result = cleanMerchantLabel("XYZ SPECIALTY GOODS TRADING CO");
      expect(result.length).toBeGreaterThan(0);
      expect(result.toUpperCase()).toContain("XYZ");
    });

    it("returns an empty string for empty input", () => {
      expect(cleanMerchantLabel("")).toBe("");
    });

    it("returns a fallback for input that's entirely reference numbers", () => {
      const result = cleanMerchantLabel("123456789012345");
      expect(result.length).toBeGreaterThan(0);
    });

    it("caps output length so a very long unmatched narration doesn't blow up the UI", () => {
      const longText = "SOME VERY LONG UNRECOGNIZED MERCHANT NARRATION TEXT THAT GOES ON AND ON AND ON FOR A WHILE";
      expect(cleanMerchantLabel(longText).length).toBeLessThanOrEqual(40);
    });
  });
});

// `cleanMerchantLabelSmart` only ever spends an LLM call on tier-3 (generic
// fallback) results: tiers 1/2 are already high confidence and must reach
// the exact same answer as the sync `cleanMerchantLabel`, with zero calls
// into the LLM/cache module, regardless of whether an API key is configured.
describe("cleanMerchantLabelSmart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the tier-1 known-merchant label directly, without touching the LLM module at all", async () => {
    const result = await cleanMerchantLabelSmart(
      "UPI/DR/103523751353/NETFLIX/HDFC/netflix.bd/Execu 0097691162095 AT 00652 MAIN BRANCH , HISAR"
    );

    expect(result).toBe("Netflix");
    expect(cleanMerchantLabelWithLlm).not.toHaveBeenCalled();
  });

  it("returns the tier-2 structural label directly, without touching the LLM module at all", async () => {
    const result = await cleanMerchantLabelSmart("INTEREST CREDIT");

    expect(result).toBe("Interest Credit");
    expect(cleanMerchantLabelWithLlm).not.toHaveBeenCalled();
  });

  it("hands tier-3 (generic fallback) narration to the LLM module with the heuristic label as the fallback", async () => {
    vi.mocked(cleanMerchantLabelWithLlm).mockResolvedValue("Xyz Specialty Goods Trading Co");

    const result = await cleanMerchantLabelSmart("XYZ SPECIALTY GOODS TRADING CO");

    expect(result).toBe("Xyz Specialty Goods Trading Co");
    expect(cleanMerchantLabelWithLlm).toHaveBeenCalledWith("XYZ SPECIALTY GOODS TRADING CO", "Xyz Specialty Goods Trading Co");
  });

  it("returns an empty string for empty input, without touching the LLM module", async () => {
    const result = await cleanMerchantLabelSmart("");

    expect(result).toBe("");
    expect(cleanMerchantLabelWithLlm).not.toHaveBeenCalled();
  });
});
