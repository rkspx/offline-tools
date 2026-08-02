import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildRedlineReport,
  compareDocuments,
  extractDocxText,
  flagRiskyChanges,
} from "./engine";

describe("document redliner engine", () => {
  it("returns structured additions and removals", () => {
    const parts = compareDocuments("Payment is due in 30 days.", "Payment is due in 10 days.");
    expect(parts.some((part) => part.kind === "removed" && part.value.includes("30"))).toBe(true);
    expect(parts.some((part) => part.kind === "added" && part.value.includes("10"))).toBe(true);
  });

  it("extracts paragraphs, tabs, and breaks from DOCX XML", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", [
      "<w:document><w:body>",
      "<w:p><w:r><w:t>First &amp; second</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>Next</w:t><w:tab/><w:t>column</w:t><w:br/><w:t>line</w:t></w:r></w:p>",
      "</w:body></w:document>",
    ].join(""));
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    await expect(extractDocxText(bytes)).resolves.toBe("First & second\nNext\tcolumn\nline");
  });

  it("flags risky language only when introduced", () => {
    const parts = compareDocuments(
      "The term is one year.",
      "The term is one year and automatically renews unless notice is sent.",
    );
    expect(flagRiskyChanges(parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Automatic renewal" }),
    ]));
  });

  it("exports an explicit non-advice report", () => {
    const parts = compareDocuments("old", "new");
    const report = buildRedlineReport("a.txt", "b.txt", parts, []);
    expect(report).toContain("not legal advice");
    expect(report).toContain("## Additions");
    expect(report).toContain("## Removals");
  });
});
