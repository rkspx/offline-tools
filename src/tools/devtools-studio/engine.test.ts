import { describe, expect, it } from "vitest";
import { compareText, isPotentiallyUnsafeRegex, jsonToTypeScript, parseLogs, runRegex, transformJson } from "./engine";

describe("DevTools Studio engine", () => {
  it("formats, minifies, and rejects invalid JSON", () => {
    expect(transformJson('{"ok":true}', "format")).toBe('{\n  "ok": true\n}');
    expect(transformJson(' { "ok": true } ', "minify")).toBe('{"ok":true}');
    expect(() => transformJson("{nope}", "format")).toThrow();
  });

  it("returns deterministic regex matches and blocks risky repetition", () => {
    expect(runRegex("(order)-(\\d+)", "i", "Order-10 order-20")).toEqual([
      { index: 0, value: "Order-10", groups: ["Order", "10"] },
      { index: 9, value: "order-20", groups: ["order", "20"] },
    ]);
    expect(isPotentiallyUnsafeRegex("(a+)+")).toBe(true);
    expect(() => runRegex("(a+)+", "", "aaaa")).toThrow(/freeze/);
  });

  it("creates nested TypeScript interfaces with safe property names", () => {
    const result = jsonToTypeScript('{"user":{"first-name":"Ada"},"active":true}', "Payload");
    expect(result).toContain("export interface PayloadUser");
    expect(result).toContain('"first-name": string;');
    expect(result).toContain("user: PayloadUser;");
  });

  it("parses JSON Lines and common text logs", () => {
    const rows = parseLogs('2026-08-02T06:40:00Z INFO ready status=200\n{"level":"error","message":"failed","code":5}');
    expect(rows[0]).toMatchObject({ timestamp: "2026-08-02T06:40:00Z", level: "INFO", fields: { status: "200" } });
    expect(rows[1]).toMatchObject({ level: "ERROR", message: "failed", fields: { code: "5" } });
  });

  it("produces stable line-level changes", () => {
    expect(compareText("one\ntwo\n", "one\nthree\n")).toEqual([
      { kind: "same", value: "one" },
      { kind: "removed", value: "two" },
      { kind: "added", value: "three" },
    ]);
  });
});
