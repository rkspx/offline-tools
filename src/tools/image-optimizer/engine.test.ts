import { describe, expect, it } from "vitest";
import {
  ASSET_PRESETS,
  applyColorThreshold,
  extensionFor,
  fitDimensions,
  formatBytes,
  savingsPercent,
} from "./engine";

describe("image optimizer engine", () => {
  it("fits dimensions without accidental upscaling", () => {
    expect(fitDimensions(4000, 2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitDimensions(400, 200, 1000, 1000)).toEqual({ width: 400, height: 200 });
    expect(fitDimensions(400, 200, 1000, 1000, true)).toEqual({ width: 1000, height: 500 });
  });

  it("removes pixels within an RGB threshold", () => {
    const pixels = new Uint8ClampedArray([
      250, 250, 250, 255,
      10, 20, 30, 255,
      240, 248, 252, 255,
    ]);
    expect(applyColorThreshold(pixels, [255, 255, 255], 10)).toBe(1);
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(255);
    expect(pixels[11]).toBe(255);
  });

  it("reports output names and size metrics", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/avif")).toBe("avif");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(savingsPercent(1000, 600)).toBe(40);
  });

  it("provides favicon and social presets", () => {
    expect(ASSET_PRESETS.favicon32).toMatchObject({ width: 32, height: 32, format: "image/png" });
    expect(ASSET_PRESETS.og).toMatchObject({ width: 1200, height: 630 });
  });
});
