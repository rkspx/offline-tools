import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { complianceReportHtml, inspectComplianceFile } from "./engine";

describe("compliance gatekeeper", () => {
  it("detects DOCX classification text, macros, and suspicious links", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document><w:p><w:t>STRICTLY CONFIDENTIAL http://10.0.0.1/login</w:t></w:p></w:document>");
    zip.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));
    const generated = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([generated], "review.docx");
    const report = await inspectComplianceFile(file);
    expect(report.findings.some((item) => item.id === "macro")).toBe(true);
    expect(report.findings.some((item) => item.label === "Restricted classification")).toBe(true);
    expect(report.links).toContain("http://10.0.0.1/login");
  });

  it("detects EML double-extension attachments without executing them", async () => {
    const eml = `Content-Type: multipart/mixed; boundary=x

--x
Content-Type: text/plain

Please review.
--x
Content-Type: application/octet-stream; name="invoice.pdf.exe"
Content-Disposition: attachment; filename="invoice.pdf.exe"
Content-Transfer-Encoding: base64

TVqQAA==
--x--`;
    const report = await inspectComplianceFile(new File([eml], "message.eml"));
    expect(report.attachments[0]?.name).toBe("invoice.pdf.exe");
    expect(report.findings.some((item) => item.label === "Double extension")).toBe(true);
    expect(complianceReportHtml({ ...report, name: "<mail>" })).toContain("&lt;mail&gt;");
  });
});
