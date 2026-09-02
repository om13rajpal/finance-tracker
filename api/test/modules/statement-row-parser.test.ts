import { describe, it, expect } from "vitest";
import type { PDFExtractPage, PDFExtractText } from "pdf.js-extract";
import {
  parseStatementRows,
  findStatementClosingBalance,
  findStatementOpeningBalance,
} from "../../src/modules/statements/statement-row-parser.service.js";

/**
 * Builds a fake `PDFExtractPage` from a plain array of "physical lines", each
 * itself an array of word/column strings. Words are spread out on the x-axis
 * in order and lines are spread out on the y-axis, so the real line-builder
 * (y-clustering + x-sort) reconstructs exactly the line order given here:
 * this is what lets these tests stay pure-function, no real PDF involved.
 */
function mkPage(lines: string[][]): PDFExtractPage {
  const content: PDFExtractText[] = [];
  lines.forEach((words, lineIdx) => {
    words.forEach((word, wordIdx) => {
      content.push({
        str: word,
        x: wordIdx * 60,
        y: lineIdx * 20,
        width: word.length * 6,
        height: 12,
        transform: [1, 0, 0, 1, wordIdx * 60, lineIdx * 20],
        font: { size: 10 },
        dir: "ltr",
        hasEOL: wordIdx === words.length - 1,
      });
    });
  });
  return {
    info: {
      num: 1,
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      width: 600,
      height: 800,
      view: { minX: 0, minY: 0, maxX: 600, maxY: 800 },
    },
    content,
  };
}

/** `pages` is a list of pages, each page itself a list of lines (each line a list of words). */
function mkPages(pages: string[][][]): PDFExtractPage[] {
  return pages.map(mkPage);
}

/** Shorthand for the common single-page case: `onePage(lines)` === `mkPages([lines])`. */
function onePage(lines: string[][]): PDFExtractPage[] {
  return mkPages([lines]);
}

describe("parseStatementRows: generic fallback (no parserKey / unknown key)", () => {
  it("parses a simple single-line date + trailing amount row", () => {
    const pages = onePage([["15/08/2026", "SOME", "MERCHANT", "199.00"]]);
    const rows = parseStatementRows(pages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-08-15", amount: 199.0 });
  });

  it("silently skips lines with no date+amount shape rather than erroring", () => {
    const pages = onePage([
      ["Statement", "of", "Account"],
      ["15/08/2026", "SOME", "MERCHANT", "199.00"],
      ["Page", "1"],
    ]);
    const rows = parseStatementRows(pages);
    expect(rows).toHaveLength(1);
  });

  it("falls back to generic for an unregistered parserKey", () => {
    const pages = onePage([["15/08/2026", "SOME", "MERCHANT", "199.00"]]);
    const rows = parseStatementRows(pages, "some_bank_nobody_wrote_a_parser_for");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-08-15", amount: 199.0 });
  });

  it("returns cleanly empty for zero pages of real content", () => {
    expect(parseStatementRows([])).toEqual([]);
    expect(parseStatementRows(mkPages([]))).toEqual([]);
  });
});

describe("parseStatementRows: sbi_statement", () => {
  it("parses a standard debit row: narration label above, multi-line description below, debit column", () => {
    const pages = onePage([
      ["WDL TFR"],
      ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/TESTMERCHANT", "-", "500.00", "-", "10,000.00"],
      ["SOME/BANK/reftest1234/UPI"],
      ["0000000000000", "AT", "00001", "TEST"],
      ["BRANCH", ",", "TESTCITY"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-08-01",
      amount: -500,
      note: "WDL TFR",
    });
    if (!("error" in rows[0])) {
      expect(rows[0].merchant).toContain("UPI/DR/111111111111/TESTMERCHANT");
      expect(rows[0].merchant).toContain("SOME/BANK/reftest1234/UPI");
    }
  });

  it("parses a credit row (mixed debit/credit columns both sign correctly)", () => {
    const pages = onePage([
      ["DEP TFR"],
      ["02/08/2026", "02/08/2026", "UPI/CR/222222222222/TESTPAYER", "-", "-", "1,234.56", "11,234.56"],
      ["OTHER/BANK/refcredit99/UPI"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-08-02", amount: 1234.56, note: "DEP TFR" });
  });

  it("parses Indian comma-grouped amounts (lakh grouping) correctly", () => {
    const pages = onePage([
      ["WDL TFR"],
      ["03/08/2026", "03/08/2026", "UPI/DR/333333333333/BIGSPEND", "-", "1,23,456.00", "-", "5,00,000.00"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: -123456 });
  });

  it("handles multiple transactions in sequence, correctly separating each one's description", () => {
    const pages = onePage([
      ["WDL TFR"],
      ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/FIRSTMERCH", "-", "10.00", "-", "990.00"],
      ["FIRST/CONTINUATION/LINE"],
      ["WDL TFR"],
      ["02/08/2026", "02/08/2026", "UPI/DR/222222222222/SECONDMERCH", "-", "20.00", "-", "970.00"],
      ["SECOND/CONTINUATION/LINE"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amount: -10, note: "WDL TFR" });
    expect(rows[1]).toMatchObject({ amount: -20, note: "WDL TFR" });
    if (!("error" in rows[0]) && !("error" in rows[1])) {
      expect(rows[0].merchant).toContain("FIRSTMERCH");
      expect(rows[0].merchant).not.toContain("SECOND");
      expect(rows[1].merchant).toContain("SECONDMERCH");
      expect(rows[1].merchant).not.toContain("FIRST");
    }
  });

  it("reports a garbage row (matches the date-start pattern but has unparseable trailing columns) as an error, without aborting the rest", () => {
    const pages = onePage([
      ["WDL TFR"],
      ["01/08/2026", "01/08/2026", "NOT", "ENOUGH", "COLUMNS"],
      ["WDL TFR"],
      ["02/08/2026", "02/08/2026", "UPI/DR/222222222222/GOODROW", "-", "20.00", "-", "980.00"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(2);
    expect("error" in rows[0]).toBe(true);
    expect(rows[1]).toMatchObject({ amount: -20 });
  });

  it("iterates all pages, not just the first", () => {
    const page1 = [
      ["WDL TFR"],
      ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/PAGEONE", "-", "10.00", "-", "990.00"],
    ];
    const page2 = [
      ["WDL TFR"],
      ["02/08/2026", "02/08/2026", "UPI/DR/222222222222/PAGETWO", "-", "20.00", "-", "970.00"],
    ];
    const rows = parseStatementRows(mkPages([page1, page2]), "sbi_statement");
    expect(rows).toHaveLength(2);
    if (!("error" in rows[1])) expect(rows[1].merchant).toContain("PAGETWO");
  });

  it("skips page-break boilerplate (Page no. N / repeated Balance header) without corrupting adjacent rows", () => {
    const page1 = [
      ["WDL TFR"],
      ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/BEFOREBREAK", "-", "10.00", "-", "990.00"],
      ["CONTINUATION/LINE/ONE"],
    ];
    const page2 = [
      ["Page", "no.", "1"],
      ["Balance"],
      ["WDL TFR"],
      ["02/08/2026", "02/08/2026", "UPI/DR/222222222222/AFTERBREAK", "-", "20.00", "-", "970.00"],
    ];
    const rows = parseStatementRows(mkPages([page1, page2]), "sbi_statement");
    expect(rows).toHaveLength(2);
    if (!("error" in rows[0])) {
      expect(rows[0].merchant).not.toContain("Page");
      expect(rows[0].merchant).not.toContain("Balance");
    }
  });

  // Reproduces a real bug found against an actual 118-page SBI statement: a
  // CASH DEPOSIT row's trailing branch-address continuation ("MAIN BRANCH ,
  // HISAR") sat immediately before an INTEREST CREDIT row, which, unlike a
  // WDL TFR / DEP TFR row, carries its description inline and has no
  // separate label line of its own. The single-lookahead rule mistook that
  // trailing continuation for INTEREST CREDIT's "label", losing it from the
  // CASH DEPOSIT row it actually described and attaching it as a bogus note
  // on the unrelated row that followed.
  it("does not steal the PREVIOUS row's trailing continuation as a label for the next row, when the next row has no label line of its own", () => {
    const pages = onePage([
      ["CASH DEPOSIT SELF AT 00652"],
      ["16/03/2022", "16/03/2022", "-", "-", "40,000.00", "43,102.00"],
      ["MAIN", "BRANCH", ",", "HISAR"],
      // No label line here: INTEREST CREDIT's description is already
      // inline on its own row-start line, exactly like the real statement.
      ["25/03/2022", "25/03/2022", "INTEREST", "CREDIT", "-", "-", "50.00", "43,152.00"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2022-03-16", amount: 40000, note: "CASH DEPOSIT SELF AT 00652" });
    if (!("error" in rows[0])) expect(rows[0].merchant).toContain("MAIN BRANCH , HISAR");
    expect(rows[1]).toMatchObject({ date: "2022-03-25", amount: 50, note: "" });
    if (!("error" in rows[1])) expect(rows[1].merchant).toBe("INTEREST CREDIT");
  });

  it("still treats a genuine comma-free label line as the upcoming row's label, not the previous row's continuation", () => {
    const pages = onePage([
      ["WDL TFR"],
      ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/FIRST", "-", "10.00", "-", "990.00"],
      ["CASH WITHDRAWAL SELF AT"],
      ["02/08/2026", "02/08/2026", "-", "20.00", "-", "970.00"],
      ["00652", "MAIN", "BRANCH"],
    ]);
    const rows = parseStatementRows(pages, "sbi_statement");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ date: "2026-08-02", amount: -20, note: "CASH WITHDRAWAL SELF AT" });
    if (!("error" in rows[1])) expect(rows[1].merchant).toContain("00652 MAIN BRANCH");
  });

  describe("findStatementClosingBalance", () => {
    it("reads the account's current \"Clear Balance\" off its own layout quirk: value merged onto a DIFFERENT line than its label", () => {
      // Confirmed against a real SBI statement: "Clear Balance" prints as its
      // own standalone line, while its value lands on a different line that
      // starts with a bare ":", merged with an unrelated field from the
      // page's other column ("Branch Phone", here) that happens to sit at a
      // similar height in the two-column Account Summary layout.
      const pages = onePage([
        ["Branch", "Email", "ID", ":", "SBI.00652@SBI.CO.IN"],
        [":", "9,894.83CR", "Branch", "Phone", ":", "9275532076"],
        ["Clear", "Balance"],
        ["Uncleared", "Amount", ":", "0.00", "CIF", "Number", ":", "90630964796"],
      ]);
      expect(findStatementClosingBalance(pages, "sbi_statement")).toBe(9894.83);
    });

    it("signs a DR (overdrawn) balance as negative", () => {
      const pages = onePage([[":", "500.00DR", "Branch", "Phone", ":", "123"]]);
      expect(findStatementClosingBalance(pages, "sbi_statement")).toBe(-500);
    });

    it("returns null when no Clear Balance line is present", () => {
      const pages = onePage([["Some", "Other", "Line"]]);
      expect(findStatementClosingBalance(pages, "sbi_statement")).toBeNull();
    });

    it("is NOT the same figure as the trailing Statement Summary's Closing Balance: the account summary's Clear Balance wins", () => {
      // Confirmed against a real 118-page SBI export: its printed
      // transaction rows stopped over a year before the statement's own
      // generation date, so the trailing summary's "Closing Balance" (which
      // only reflects the last transaction actually included) was ~8,300
      // less than the account's true current balance. Using the LAST
      // transaction row's balance (or this trailing summary) instead of
      // "Clear Balance" would reconcile the account to a stale figure.
      const pages = onePage([
        [":", "9,894.83CR", "Branch", "Phone", ":", "9275532076"],
        ["Clear", "Balance"],
        ["Statement", "Summary", ":", "02-09-2020", "To", "01-09-2026"],
        ["Brought", "Forward", "Dr", "Count", "Cr", "Count", "Total", "Debits", "Total", "Credits", "Closing", "Balance"],
        ["0.00", "1229", "297", "15,17,586.15", "15,19,181.96", "1,595.81CR"],
      ]);
      expect(findStatementClosingBalance(pages, "sbi_statement")).toBe(9894.83);
    });
  });
});

describe("parseStatementRows: hdfc_statement", () => {
  const HEADER_ROW = [
    "Date",
    "Narration",
    "Chq.",
    "/",
    "Ref",
    "No.",
    "Value",
    "Date",
    "Withdrawal",
    "Amount",
    "Deposit",
    "Amount",
    "Closing",
    "Balance*",
  ];

  it("parses a row with narration split before and after the anchor line, and a ref number", () => {
    const pages = onePage([
      HEADER_ROW,
      ["UPI-TEST", "PAYEE-somepayee@okbank-BANK00"],
      ["04/04/2026", "111111111111", "04/04/2026", "0.00", "30,000.00", "55,003.00"],
      ["00001-111111111111-UPI"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-04-04", amount: 30000 });
    if (!("error" in rows[0])) {
      expect(rows[0].merchant).toContain("UPI-TEST");
      expect(rows[0].merchant).toContain("00001-111111111111-UPI");
    }
  });

  it("parses a withdrawal row with narration fully on the anchor line and no continuation", () => {
    const pages = onePage([
      HEADER_ROW,
      ["07/04/2026", "DEBIT", "CARD", "FEE-TEST123", "TEST123", "07/04/2026", "354.00", "0.00", "54,649.00"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-04-07", amount: -354 });
    if (!("error" in rows[0])) expect(rows[0].merchant).toContain("DEBIT CARD FEE-TEST123");
  });

  it("treats a blank Chq./Ref No. column as null, not an error", () => {
    const pages = onePage([
      HEADER_ROW,
      ["13/05/2026", "CRV", "POS", "TEST", "MERCHANT", "13/05/2026", "0.00", "3,099.40", "3,20,812.08"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 3099.4 });
  });

  it("signs a negative withdrawal (a reversal) as a positive amount", () => {
    const pages = onePage([
      HEADER_ROW,
      ["31/05/2026", "REF999999", "31/05/2026", "-93.98", "0.00", "2,50,230.40"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 93.98 });
  });

  it("skips the repeated account/address header block on page 2+ without absorbing it into a row's narration", () => {
    const page1 = [HEADER_ROW, ["04/04/2026", "111111111111", "04/04/2026", "0.00", "30,000.00", "55,003.00"]];
    const page2 = [
      ["Page", "2", "of", "2"],
      ["Account", "Branch", ":", "Test", "Branch"],
      ["Statement", "From", ":", "31/07/25", "TO", ":", "31/05/26"],
      ["13/05/2026", "SOME", "MERCHANT", "REF12345", "13/05/2026", "0.00", "99.00", "3,45,071.43"],
    ];
    const rows = parseStatementRows(mkPages([page1, page2]), "hdfc_statement");
    expect(rows).toHaveLength(2);
    if (!("error" in rows[1])) {
      expect(rows[1].merchant).not.toContain("Account Branch");
      expect(rows[1].merchant).not.toContain("Statement From");
    }
  });

  it("handles multiple transactions in sequence without bleeding narration across rows", () => {
    const pages = onePage([
      HEADER_ROW,
      ["UPI-FIRST-PAYEE@okbank"],
      ["04/04/2026", "111111111111", "04/04/2026", "0.00", "30,000.00", "55,003.00"],
      ["00001-111111111111-UPI"],
      ["UPI-SECOND-PAYEE@okbank"],
      ["05/04/2026", "222222222222", "05/04/2026", "500.00", "0.00", "54,503.00"],
      ["00001-222222222222-UPI"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(2);
    if (!("error" in rows[0]) && !("error" in rows[1])) {
      expect(rows[0].merchant).toContain("FIRST");
      expect(rows[0].merchant).not.toContain("SECOND");
      expect(rows[1].merchant).toContain("SECOND");
      expect(rows[1].merchant).not.toContain("FIRST");
    }
  });

  // Some real HDFC statement exports (confirmed against an actual HDFC PPF
  // e-statement, not committed anywhere) omit the empty side of
  // Withdrawal/Deposit from the row entirely instead of zero-padding it:
  // only ONE trailing amount token is printed, not the two every fixture
  // above uses. These tests cover that shape directly.
  const SUMMARY_LINES = (openingBalance: string, crCount: number, credits: string, closingBal: string) => [
    ["STATEMENT", "SUMMARY", ":-"],
    ["Opening", "Balance", "Dr", "Count", "Cr", "Count", "Debits", "Credits", "Closing", "Bal"],
    [openingBalance, "0", String(crCount), "0.00", credits, closingBal],
  ];

  it("infers a deposit from a single-amount-column row using this statement's own Opening Balance", () => {
    const pages = onePage([
      HEADER_ROW,
      ["06/06/2026", "NB", "Subscription", "Transfer", "-", "06/06/2026", "5,000.00", "5,000.00"],
      ...SUMMARY_LINES("0.00", 1, "5,000.00", "5,000.00"),
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-06-06", amount: 5000 });
    if (!("error" in rows[0])) {
      // The summary block's own header/value lines must not leak into the
      // last (and only) real row's narration.
      expect(rows[0].merchant).not.toMatch(/summary|opening|closing|bal/i);
    }
  });

  it("infers direction for a single-amount-column row from the PREVIOUS row's own balance, without needing the opening-balance summary", () => {
    const pages = onePage([
      HEADER_ROW,
      // Row 1: ordinary two-amount-column row, establishes balance = 40,000.
      ["01/08/2026", "NB", "Subscription", "-", "01/08/2026", "0.00", "40,000.00", "40,000.00"],
      // Row 2: single-amount-column row where the balance goes DOWN: must
      // resolve as a withdrawal (negative), not a deposit.
      ["05/08/2026", "Some", "Debit", "-", "05/08/2026", "15,000.00", "25,000.00"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amount: 40000 });
    expect(rows[1]).toMatchObject({ amount: -15000 });
  });

  it("carries the running balance across MULTIPLE consecutive single-amount-column rows correctly (mirrors the real PPF statement this fix was built for)", () => {
    const pages = onePage([
      HEADER_ROW,
      ["30/07/2026", "NB", "Subscription", "Transfer", "-", "30/07/2026", "5,000.00", "5,000.00"],
      ["01/08/2026", "NB", "Subscription", "-", "01/08/2026", "35,000.00", "40,000.00"],
      ["14/08/2026", "NB", "Subscription", "-", "14/08/2026", "20,000.00", "60,000.00"],
      ...SUMMARY_LINES("0.00", 3, "60,000.00", "60,000.00"),
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => ("error" in r ? r.error : r.amount))).toEqual([5000, 35000, 20000]);
    expect(rows.map((r) => ("error" in r ? r.error : r.date))).toEqual(["2026-07-30", "2026-08-01", "2026-08-14"]);
  });

  it("reports a single-amount-column row as an error rather than guessing a sign, when there's no reference balance at all", () => {
    const pages = onePage([
      HEADER_ROW,
      // No prior row and no STATEMENT SUMMARY block in this document, so
      // there's genuinely nothing to compare this row's balance against.
      ["06/06/2026", "Mystery", "Row", "-", "06/06/2026", "5,000.00", "5,000.00"],
    ]);
    const rows = parseStatementRows(pages, "hdfc_statement");
    expect(rows).toHaveLength(1);
    expect("error" in rows[0]).toBe(true);
  });

  // Confirmed against a real, newer HDFC savings-account e-statement (a
  // later date range than the PPF statement above, same underlying
  // account): its transaction AND value-date columns print `DD/MM/YY`
  // (2-digit year, e.g. `31/05/26`) instead of `DD/MM/YYYY`. Before this was
  // fixed, `ANCHOR_RE` never matched a single row of that real file: it
  // silently parsed ZERO of its ~117 real transactions. These tests cover
  // that date shape directly; 4-digit-year rows are covered by every test
  // above, unchanged.
  describe("2-digit-year (DD/MM/YY) transaction dates", () => {
    it("parses a two-amount-column row whose date and value date both use a 2-digit year", () => {
      const pages = onePage([
        HEADER_ROW,
        ["31/05/26", "UPI-DOMINOS-payee@okbank", "REF12345", "31/05/26", "649.00", "0.00", "3,55,901.34"],
      ]);
      const rows = parseStatementRows(pages, "hdfc_statement");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ date: "2026-05-31", amount: -649 });
    });

    it("parses a single-amount-column 2-digit-year row too, inferring direction the same way a 4-digit-year row would", () => {
      const pages = onePage([
        HEADER_ROW,
        ["01/06/26", "NB", "Subscription", "-", "01/06/26", "1,200.00", "1,200.00"],
      ]);
      const rows = parseStatementRows(pages, "hdfc_statement");
      expect(rows).toHaveLength(1);
      // No reference balance available (no prior row, no summary block), so,
      // same as the 4-digit-year case above, this is correctly reported
      // as unresolvable rather than a silent wrong guess.
      expect("error" in rows[0]).toBe(true);
    });

    it("mirrors the real HDFC savings-account bug this fix was built for: a full statement of 2-digit-year rows, all parsing correctly, with the correct closing balance read off a summary block where opening != closing", () => {
      const pages = onePage([
        HEADER_ROW,
        ["31/05/26", "UPI-DOMINOS-payee@okbank", "REF11111", "31/05/26", "649.00", "0.00", "2,49,581.40"],
        ["01/06/26", "UPI-AMAZON", "PAY-payee@okbank", "REF22222", "01/06/26", "0.00", "2,500.00", "2,52,081.40"],
        ["02/06/26", "UPI-DTDC", "EXPRESS-payee@okbank", "REF33333", "02/06/26", "180.00", "0.00", "2,51,901.40"],
        ...SUMMARY_LINES("2,50,230.40", 2, "2,500.00", "2,51,901.40"),
      ]);
      const rows = parseStatementRows(pages, "hdfc_statement");
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => ("error" in r ? r.error : r.date))).toEqual([
        "2026-05-31",
        "2026-06-01",
        "2026-06-02",
      ]);
      expect(rows.map((r) => ("error" in r ? r.error : r.amount))).toEqual([-649, 2500, -180]);
      // The real bug being regression-tested: this must be the statement's
      // actual CLOSING balance (251901.40), never its opening balance
      // (250230.40): those two are deliberately different in this fixture
      // so a test reading the wrong one would fail loudly.
      expect(findStatementClosingBalance(pages, "hdfc_statement")).toBe(251901.4);
    });

    it("accepts a mix of 4-digit- and 2-digit-year rows in the same statement (e.g. a statement whose date range straddles the format change)", () => {
      const pages = onePage([
        HEADER_ROW,
        ["30/12/2025", "OLD", "FORMAT", "ROW", "REF1", "30/12/2025", "100.00", "0.00", "9,900.00"],
        ["02/01/26", "NEW", "FORMAT", "ROW", "REF2", "02/01/26", "0.00", "200.00", "10,100.00"],
      ]);
      const rows = parseStatementRows(pages, "hdfc_statement");
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => ("error" in r ? r.error : r.date))).toEqual(["2025-12-30", "2026-01-02"]);
      expect(rows.map((r) => ("error" in r ? r.error : r.amount))).toEqual([-100, 200]);
    });
  });

  describe("findStatementClosingBalance", () => {
    it("reads the statement's own closing balance off its last transaction row's stated balance", () => {
      const pages = onePage([
        HEADER_ROW,
        ["30/07/2026", "NB", "Subscription", "-", "30/07/2026", "5,000.00", "5,000.00"],
        ["01/08/2026", "NB", "Subscription", "-", "01/08/2026", "35,000.00", "40,000.00"],
        ["14/08/2026", "NB", "Subscription", "-", "14/08/2026", "20,000.00", "60,000.00"],
        ...SUMMARY_LINES("0.00", 3, "60,000.00", "60,000.00"),
      ]);
      expect(findStatementClosingBalance(pages, "hdfc_statement")).toBe(60000);
    });

    it("falls back to the statement's own Opening Balance when it has no transaction rows at all", () => {
      const pages = onePage([HEADER_ROW, ...SUMMARY_LINES("12,345.00", 0, "0.00", "12,345.00")]);
      expect(findStatementClosingBalance(pages, "hdfc_statement")).toBe(12345);
    });

    // Regression test for a real, production-reachable bug: when zero
    // transaction rows are parsed off a document that DOES have real
    // transactions (as this one's own Dr/Cr counts and Debits/Credits say),
    // the fallback must read the summary block's own explicitly-labeled
    // "Closing Bal", never its "Opening Balance", which is only the same
    // number by coincidence for a GENUINELY empty statement. Opening and
    // closing are deliberately different here so a fallback that grabbed the
    // wrong column (as the buggy code did, see `ANCHOR_RE`'s doc comment)
    // would fail this test loudly instead of silently passing.
    it("reads the summary's own Closing Bal specifically (not Opening Balance) when zero rows parse from an otherwise non-empty statement", () => {
      const pages = onePage([HEADER_ROW, ...SUMMARY_LINES("2,50,230.40", 16, "9,11,293.91", "3,55,901.34")]);
      expect(findStatementClosingBalance(pages, "hdfc_statement")).toBe(355901.34);
    });

    it("returns null when the document has neither transaction rows nor a summary block", () => {
      const pages = onePage([HEADER_ROW]);
      expect(findStatementClosingBalance(pages, "hdfc_statement")).toBeNull();
    });

    it("returns null for a parser with no closing-balance support (e.g. SBI), not an error", () => {
      const pages = onePage([
        ["WDL TFR"],
        ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/TESTMERCHANT", "-", "500.00", "-", "10,000.00"],
      ]);
      expect(findStatementClosingBalance(pages, "sbi_statement")).toBeNull();
    });

    it("returns null when no parserKey is given at all", () => {
      const pages = onePage([["15/08/2026", "SOME", "MERCHANT", "199.00"]]);
      expect(findStatementClosingBalance(pages)).toBeNull();
    });
  });

  describe("findStatementOpeningBalance", () => {
    it("reads the statement's own printed Opening Balance off the STATEMENT SUMMARY block (HDFC)", () => {
      const pages = onePage([
        HEADER_ROW,
        ["30/07/2026", "NB", "Subscription", "-", "30/07/2026", "5,000.00", "5,000.00"],
        ...SUMMARY_LINES("0.00", 1, "5,000.00", "5,000.00"),
      ]);
      expect(findStatementOpeningBalance(pages, "hdfc_statement")).toBe(0);
    });

    it("returns null for a parser with no opening-balance support at all (SBI's 'closing balance' isn't opening+rows-based)", () => {
      const pages = onePage([
        ["WDL TFR"],
        ["01/08/2026", "01/08/2026", "UPI/DR/111111111111/TESTMERCHANT", "-", "500.00", "-", "10,000.00"],
      ]);
      expect(findStatementOpeningBalance(pages, "sbi_statement")).toBeNull();
    });

    it("returns null when no parserKey is given at all", () => {
      const pages = onePage([["15/08/2026", "SOME", "MERCHANT", "199.00"]]);
      expect(findStatementOpeningBalance(pages)).toBeNull();
    });
  });
});
