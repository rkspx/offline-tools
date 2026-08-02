import { describe, expect, it } from "vitest";
import {
  checkContrast,
  dominantColors,
  hexToRgb,
  paletteToCss,
  paletteToJson,
  paletteToTailwind,
  rgbToHex,
  type RGB,
} from "./engine";

describe("palette checker engine", () => {
  it("converts RGB and hex values", () => {
    expect(rgbToHex([12, 128, 255])).toBe("#0C80FF");
    expect(hexToRgb("#0c80ff")).toEqual([12, 128, 255]);
    expect(hexToRgb("bad")).toBeNull();
  });

  it("reports WCAG contrast thresholds", () => {
    expect(checkContrast([0, 0, 0], [255, 255, 255])).toEqual({
      ratio: 21,
      normalAA: true,
      normalAAA: true,
      largeAA: true,
      largeAAA: true,
    });
    expect(checkContrast([119, 119, 119], [255, 255, 255]).normalAA).toBe(false);
  });

  it("extracts deterministic dominant colors", () => {
    const pixels: RGB[] = [
      ...Array.from({ length: 8 }, (): RGB => [250, 10, 10]),
      ...Array.from({ length: 2 }, (): RGB => [10, 20, 250]),
    ];
    const first = dominantColors(pixels, 2);
    const second = dominantColors(pixels, 2);
    expect(first).toEqual(second);
    expect(first[0]?.hex).toBe("#FA0A0A");
    expect(first[0]?.percentage).toBe(80);
  });

  it("exports CSS, Tailwind, and Figma-style JSON", () => {
    const colors = dominantColors([[20, 40, 60]], 1);
    expect(paletteToCss(colors)).toContain("--color-1: #14283C;");
    expect(paletteToTailwind(colors)).toContain('1: "#14283C"');
    const tokens = JSON.parse(paletteToJson(colors)) as {
      color: Record<string, { type: string }>;
    };
    expect(tokens.color["palette-1"]?.type).toBe("color");
  });
});
