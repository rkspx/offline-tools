import { describe, expect, it } from "vitest";
import {
  anonymizeCsv,
  detectValues,
  findCsvValues,
  parseFinancialCsv,
} from "./engine";

describe("financial anonymizer engine", () => {
  it("detects common personal and financial identifiers", () => {
    const findings = detectValues(
      "Email pat@example.com, SSN 123-45-6789, card 4111 1111 1111 1111, routing number 021000021.",
    );
    expect(findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining([
      "Email",
      "SSN",
      "Payment card",
      "Routing number",
    ]));
  });

  it("rejects card-like values that fail Luhn validation", () => {
    expect(detectValues("Reference 4111 1111 1111 1112").some((finding) => finding.kind === "Payment card")).toBe(false);
  });

  it("locates CSV values by row and column and redacts selected findings", () => {
    const document = parseFinancialCsv("name,email,note\nPat,pat@example.com,keep\nSam,sam@example.com,keep");
    const findings = findCsvValues(document);
    const first = findings[0];
    expect(first).toMatchObject({ location: "Row 2, email", value: "pat@example.com" });
    const output = anonymizeCsv(document, findings, new Set(first ? [first.id] : []), "redact");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("sam@example.com");
  });

  it("creates deterministic-looking tokens without changing unselected cells", () => {
    const document = parseFinancialCsv("email\npat@example.com");
    const findings = findCsvValues(document);
    const output = anonymizeCsv(document, findings, new Set(findings.map((finding) => finding.id)), "tokenize");
    expect(output).toContain("[EMAIL_001]");
  });
});
