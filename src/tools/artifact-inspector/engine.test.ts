import { describe, expect, it } from "vitest";
import { artifactReportHtml, CURATED_ARTIFACT_RULES } from "./engine";
import { compileAndScan } from "../security-shared/yara";

describe("artifact inspector", () => {
  it("detects an MZ header and command indicators", () => {
    const bytes = new Uint8Array([0x4d, 0x5a, ...new TextEncoder().encode(" powershell curl https://example.test")]);
    const result = compileAndScan(CURATED_ARTIFACT_RULES, bytes);
    expect(result.rules.find((rule) => rule.rule === "Executable_Header")?.matched).toBe(true);
    expect(result.rules.find((rule) => rule.rule === "Script_Downloader_Indicators")?.matched).toBe(true);
  });

  it("escapes report content", () => {
    const html = artifactReportHtml({
      name: "<img>.bin", size: 1, type: "test", sha256: "abc", createdAt: "now", disclaimer: "<unsafe>",
      scan: compileAndScan("rule None { condition: false }", new Uint8Array([1])),
      hex: "<script>", text: "",
    });
    expect(html).toContain("&lt;img&gt;.bin");
    expect(html).not.toContain("<script>");
  });
});
