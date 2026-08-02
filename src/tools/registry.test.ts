import { describe, expect, it } from "vitest";
import { getTool, tools } from "./registry";

describe("tool registry", () => {
  it("contains 23 unique tools", () => {
    expect(tools).toHaveLength(23);
    expect(new Set(tools.map((tool) => tool.slug)).size).toBe(23);
  });

  it("finds a tool by slug", () => {
    expect(getTool("structural-diff")?.name).toBe("Structural Diff");
    expect(getTool("missing")).toBeUndefined();
  });
});
