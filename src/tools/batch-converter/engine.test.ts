import { describe, expect, it } from "vitest";
import {
  BUNDLED_RATES,
  convertCurrency,
  convertRows,
  convertTimezone,
  convertUnit,
  importCurrencyRates,
  parseCsv,
  serializeCsv,
} from "./engine";

describe("batch converter engine", () => {
  it("parses and serializes CSV with quoted values", () => {
    const rows = parseCsv('name,distance\n"North, route",12.5');
    expect(rows).toEqual([{ name: "North, route", distance: "12.5" }]);
    expect(serializeCsv(rows)).toContain('"North, route"');
  });

  it("converts common physical and data units", () => {
    expect(convertUnit(1, "length", "mi", "km")).toBeCloseTo(1.609344);
    expect(convertUnit(32, "temperature", "F", "C")).toBeCloseTo(0);
    expect(convertUnit(1, "volume", "gal", "l")).toBeCloseTo(3.785411784);
    expect(convertUnit(1, "data", "GiB", "MB")).toBeCloseTo(1073.741824);
  });

  it("converts currencies through the snapshot base", () => {
    const euroRate = BUNDLED_RATES.rates.EUR ?? 0;
    const poundRate = BUNDLED_RATES.rates.GBP ?? 0;
    expect(convertCurrency(10, "EUR", "GBP", BUNDLED_RATES)).toBeCloseTo(
      (10 / euroRate) * poundRate,
    );
  });

  it("imports JSON and CSV currency snapshots", () => {
    expect(importCurrencyRates('{"base":"USD","date":"2026-01-02","rates":{"EUR":0.9}}')).toMatchObject({
      date: "2026-01-02",
      rates: { USD: 1, EUR: 0.9 },
    });
    expect(importCurrencyRates("currency,rate,date,base\nEUR,0.91,2026-01-03,USD").rates.EUR).toBe(0.91);
  });

  it("detects DST gaps and folds", () => {
    expect(convertTimezone("2026-03-08 02:30", "America/New_York", "UTC").warning).toContain("does not exist");
    expect(convertTimezone("2026-11-01 01:30", "America/New_York", "UTC").warning).toContain("occurs twice");
  });

  it("keeps row-level errors while converting valid rows", () => {
    const results = convertRows(
      [{ value: "1" }, { value: "not-a-number" }],
      { sourceColumn: "value", outputColumn: "meters", kind: "length", from: "km", to: "m" },
    );
    expect(results[0]?.row.meters).toBe("1000");
    expect(results[1]?.error).toContain("not a number");
  });
});
