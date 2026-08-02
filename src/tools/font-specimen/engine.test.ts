import { describe, expect, it } from "vitest";
import {
  fontNameFromFile,
  generateTypeScale,
  toCssVariables,
  toTokenJson,
} from "./engine";

describe("font specimen engine", () => {
  it("generates a modular scale around the base", () => {
    const scale = generateTypeScale(16, 1.25, 1, 2);
    expect(scale.map((token) => token.sizePx)).toEqual([12.8, 16, 20, 25]);
    expect(scale.map((token) => token.name)).toEqual(["minus-1", "base", "plus-1", "plus-2"]);
  });

  it("guards invalid scale inputs", () => {
    const scale = generateTypeScale(0, 0, 0, 1);
    expect(scale[0]?.sizePx).toBe(1);
    expect(scale[1]?.sizePx).toBe(1.01);
  });

  it("exports CSS and Figma-style tokens", () => {
    const options = {
      family: 'Display "One"',
      basePx: 16,
      ratio: 1.2,
      stepsBelow: 0,
      stepsAbove: 1,
    };
    expect(toCssVariables(options)).toContain('--font-family: "Display \\"One\\"";');
    const json = JSON.parse(toTokenJson(options)) as {
      font: { size: { base: { type: string } } };
    };
    expect(json.font.size.base.type).toBe("dimension");
  });

  it("creates a readable name from a file", () => {
    expect(fontNameFromFile("Atkinson-Hyperlegible_Bold.woff2")).toBe(
      "Atkinson Hyperlegible Bold",
    );
  });
});
