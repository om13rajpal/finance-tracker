import { describe, it, expect } from "vitest";
import type { PDFExtractPage, PDFExtractText } from "pdf.js-extract";
import { detectStatementParserKey } from "../../src/modules/statements/detect-bank.js";

// Same fixture-building approach as statement-row-parser.test.ts's `mkPage`:
// spreads words out on the x-axis and lines on the y-axis so the real
// line-builder reconstructs the given line order, no real PDF involved.
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

describe("detectStatementParserKey", () => {
  it("detects HDFC from the bank's own footer boilerplate", () => {
    const pages = [mkPage([["Some", "narration", "line"], ["HDFC", "BANK", "LIMITED"]])];
    expect(detectStatementParserKey(pages)).toBe("hdfc_statement");
  });

  it("detects SBI from the bank's full legal name", () => {
    const pages = [mkPage([["Statement", "of", "account"], ["STATE", "BANK", "OF", "INDIA"]])];
    expect(detectStatementParserKey(pages)).toBe("sbi_statement");
  });

  it("detects SBI from a sbi.co.in branch email domain even without the full bank name", () => {
    const pages = [mkPage([["Branch", "Email", ":", "SBI.00652@SBI.CO.IN"]])];
    expect(detectStatementParserKey(pages)).toBe("sbi_statement");
  });

  it("returns undefined for a statement from neither bank, not a guess", () => {
    const pages = [mkPage([["Some", "Other", "Bank", "Statement"]])];
    expect(detectStatementParserKey(pages)).toBeUndefined();
  });

  it("returns undefined for an empty document", () => {
    expect(detectStatementParserKey([])).toBeUndefined();
  });
});
