import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET,
  layoutLabels,
  mapRows,
  parseCsv,
  sheetCapacity,
  validateBarcode,
  validateSheet,
} from "./engine";

describe("barcode labeler engine", () => {
  it("parses and maps CSV columns", () => {
    const rows = parseCsv("product_sku,title,url\nA-1,Studio Mug,https://example.test/a");
    expect(mapRows(rows, { sku: "product_sku", name: "title", value: "url" })).toEqual([
      { sku: "A-1", name: "Studio Mug", value: "https://example.test/a", sourceIndex: 0 },
    ]);
  });

  it("validates common barcode formats", () => {
    expect(validateBarcode("ABC-123", "code39")).toBeNull();
    expect(validateBarcode("abc", "code39")).toContain("uppercase");
    expect(validateBarcode("123456789012", "ean13")).toBeNull();
    expect(validateBarcode("12345", "interleaved2of5")).toContain("even");
    expect(validateBarcode("https://example.test", "qrcode")).toBeNull();
  });

  it("calculates deterministic sheet positions", () => {
    const capacity = sheetCapacity(DEFAULT_SHEET);
    expect(capacity).toEqual({ columns: 3, rows: 7, perPage: 21 });
    const positions = layoutLabels(22, DEFAULT_SHEET);
    expect(positions[0]).toMatchObject({ page: 0, xMm: 12, yMm: 12 });
    expect(positions[21]).toMatchObject({ page: 1, xMm: 12, yMm: 12 });
  });

  it("rejects impossible sheet geometry", () => {
    expect(validateSheet({ ...DEFAULT_SHEET, labelWidthMm: 500 })).toContain("At least one label must fit inside the sheet margins.");
  });
});
