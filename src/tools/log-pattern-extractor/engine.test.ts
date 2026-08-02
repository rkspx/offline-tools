import { describe, expect, it } from "vitest";
import { extractLogPatterns, rowsToCsv, rowsToJson, validateRule, type PatternRule } from "./engine";

describe("log pattern extraction engine", () => {
  it("detects built-in values and joins stack frames to their error", () => {
    const rows = extractLogPatterns(
      "2026-08-02T06:40:00Z ERROR request failed ip=192.168.1.5 id=8e13c8af-29d4-4d4a-8c4e-7c6d7ee6019e\n    at run (app.js:2:3)",
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timestamp: "2026-08-02T06:40:00Z",
      level: "ERROR",
      ip: "192.168.1.5",
      uuid: "8e13c8af-29d4-4d4a-8c4e-7c6d7ee6019e",
    });
    expect(rows[0]?.stackTrace).toContain("at run");
  });

  it("extracts the first capture group from named custom rules", () => {
    const rules: PatternRule[] = [{ id: "1", name: "status", pattern: "status=(\\d+)", flags: "", enabled: true }];
    expect(extractLogPatterns("INFO status=204", rules)[0]?.custom.status).toBe("204");
  });

  it("validates unsupported flags and unsafe patterns", () => {
    expect(validateRule({ id: "1", name: "bad", pattern: "(a+)+", flags: "", enabled: true })).toMatch(/freeze/);
    expect(validateRule({ id: "2", name: "bad", pattern: "a", flags: "g", enabled: true })).toMatch(/support/);
  });

  it("exports predictable CSV and JSON with custom columns", () => {
    const rows = extractLogPatterns("INFO service=api", [{ id: "1", name: "service", pattern: "service=(\\w+)", flags: "", enabled: true }]);
    expect(rowsToCsv(rows)).toContain("stackTrace,service");
    expect(rowsToCsv(rows)).toContain("api");
    expect(JSON.parse(rowsToJson(rows))).toMatchObject([{ level: "INFO", service: "api" }]);
  });
});
