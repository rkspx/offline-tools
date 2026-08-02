import { describe, expect, it } from "vitest";
import {
  chartPoints,
  resultToCsv,
  resultToHtml,
  safeTableName,
  validateReadOnlySql,
  type QueryResult,
} from "./engine";

const result: QueryResult = {
  columns: ["city", "orders"],
  rows: [["Montréal", 12], ["New York, NY", 8], ["<script>", null]],
  elapsedMs: 7,
  truncated: false,
};

describe("validateReadOnlySql", () => {
  it("accepts one read-only statement", () => {
    expect(validateReadOnlySql("WITH rows AS (SELECT 1 AS n) SELECT * FROM rows;"))
      .toBe("WITH rows AS (SELECT 1 AS n) SELECT * FROM rows");
    expect(validateReadOnlySql("-- inspect\nDESCRIBE events")).toContain("DESCRIBE events");
  });

  it("ignores blocked words inside strings and comments", () => {
    expect(validateReadOnlySql("SELECT 'drop table', \"update\" FROM events -- attach"))
      .toContain("'drop table'");
  });

  it("blocks mutations, external reads, and multiple statements", () => {
    expect(() => validateReadOnlySql("DROP TABLE events")).toThrow(/read-only/i);
    expect(() => validateReadOnlySql("SELECT * FROM read_csv_auto('https://example.com/a.csv')")).toThrow(/blocked/i);
    expect(() => validateReadOnlySql("SELECT * FROM 'https://example.com/a.csv'")).toThrow(/blocked/i);
    expect(() => validateReadOnlySql("SELECT 1; SELECT 2")).toThrow(/one statement/i);
  });
});

describe("safeTableName", () => {
  it("normalizes names and resolves collisions", () => {
    expect(safeTableName("2026 Sales (Final).csv")).toBe("data_2026_sales_final");
    expect(safeTableName("Résumé.json", ["resume"])).toBe("resume_2");
    expect(safeTableName(".csv")).toBe("imported_data");
  });
});

describe("exports", () => {
  it("creates escaped CSV", () => {
    const csv = resultToCsv(result);
    expect(csv).toContain('"New York, NY",8');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("creates a standalone escaped HTML report", () => {
    const html = resultToHtml(result, "SELECT * FROM data", "sample.csv");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("chartPoints", () => {
  it("keeps only numeric points", () => {
    expect(chartPoints(result, "city", "orders")).toEqual([
      { label: "Montréal", value: 12 },
      { label: "New York, NY", value: 8 },
    ]);
  });
});
