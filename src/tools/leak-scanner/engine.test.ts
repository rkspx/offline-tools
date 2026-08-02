import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { leakReportHtml, scanFiles, scanText } from "./engine";

describe("leak scanner", () => {
  it("finds credentials and masks evidence", () => {
    const findings = scanText("api_key=supersecretvalue\nuser=test@example.com", "sample");
    expect(findings.some((item) => item.ruleId === "assignment-secret")).toBe(true);
    expect(findings.some((item) => item.ruleId === "email")).toBe(true);
    expect(findings.map((item) => item.context).join(" ")).not.toContain("supersecretvalue");
  });

  it("uses Luhn validation to reduce card false positives", () => {
    expect(scanText("card 4111 1111 1111 1111").some((item) => item.ruleId === "credit-card")).toBe(true);
    expect(scanText("card 4111 1111 1111 1112").some((item) => item.ruleId === "credit-card")).toBe(false);
  });

  it("scans bounded ZIP text entries and escapes HTML", async () => {
    const zip = new JSZip();
    zip.file("config.env", "password=actualproductionsecret");
    const generated = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([generated], "source.zip");
    const report = await scanFiles([file]);
    expect(report.findings[0]?.source).toBe("source.zip/config.env");
    expect(leakReportHtml({ ...report, findings: report.findings.map((item) => ({ ...item, source: "<bad>" })) })).toContain("&lt;bad&gt;");
  });
});
