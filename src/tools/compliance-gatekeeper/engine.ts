import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { escapeHtml, MAX_ARCHIVE_BYTES, readBoundedZip, sha256 } from "../security-shared/utils";

export type GateSeverity = "critical" | "high" | "medium" | "info";
export type GateFinding = { id: string; label: string; severity: GateSeverity; detail: string; evidence?: string };
export type AttachmentInfo = { name: string; size: number; mediaType: string; sha256: string; findings: GateFinding[] };
export type ComplianceInspection = {
  name: string; type: string; size: number; sha256: string; inspectedAt: string; textLength: number;
  links: string[]; attachments: AttachmentInfo[]; findings: GateFinding[]; textPreview: string;
  disclaimer: string;
};

const DOUBLE_EXTENSION = /\.(?:pdf|docx?|xlsx?|jpe?g|png|txt)\.(?:exe|scr|com|bat|cmd|js|vbs|ps1|msi)$/i;
const DANGEROUS_EXTENSION = /\.(?:exe|scr|com|bat|cmd|js|jse|vbs|vbe|ps1|msi|dll|hta)$/i;
const CLASSIFICATIONS = [
  { label: "Restricted classification", severity: "high" as const, pattern: /\b(?:top secret|strictly confidential|restricted)\b/i },
  { label: "Confidential classification", severity: "medium" as const, pattern: /\b(?:confidential|internal use only|proprietary)\b/i },
  { label: "Personal or regulated data wording", severity: "medium" as const, pattern: /\b(?:social security number|patient record|personal data|cardholder data|protected health information)\b/i },
];

function decodeXml(value: string) {
  return value.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

async function pdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: bytes });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 200); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
  } finally { await task.destroy(); }
  return pages.join("\n");
}

function extractLinks(text: string) {
  return [...new Set(text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? [])].slice(0, 500);
}

function linkFindings(links: string[]): GateFinding[] {
  return links.flatMap((link, index) => {
    let url: URL;
    try { url = new URL(link); } catch { return []; }
    const findings: GateFinding[] = [];
    if (url.protocol === "http:") findings.push({ id: `http-${index}`, label: "Unencrypted external link", severity: "medium", detail: url.hostname, evidence: link });
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || /(?:xn--|bit\.ly$|tinyurl\.com$|t\.co$)/i.test(url.hostname)) findings.push({ id: `obscured-${index}`, label: "Obscured or shortened link", severity: "high", detail: url.hostname, evidence: link });
    if (url.username || url.password || url.hostname.split(".").length > 5) findings.push({ id: `odd-${index}`, label: "Unusual link structure", severity: "medium", detail: url.hostname, evidence: link });
    return findings;
  });
}

function textFindings(text: string): GateFinding[] {
  return CLASSIFICATIONS.flatMap((rule, index) => {
    const match = rule.pattern.exec(text);
    return match ? [{ id: `class-${index}`, label: rule.label, severity: rule.severity, detail: "Classification or handling language detected.", evidence: match[0] }] : [];
  });
}

async function attachment(name: string, bytes: Uint8Array, mediaType = "application/octet-stream"): Promise<AttachmentInfo> {
  const findings: GateFinding[] = [];
  if (DOUBLE_EXTENSION.test(name)) findings.push({ id: "double-extension", label: "Double extension", severity: "critical", detail: "The visible document extension is followed by an executable extension.", evidence: name });
  else if (DANGEROUS_EXTENSION.test(name)) findings.push({ id: "active-extension", label: "Active-code attachment", severity: "high", detail: "Attachment extension can execute code.", evidence: name });
  return { name, size: bytes.byteLength, mediaType, sha256: await sha256(bytes), findings };
}

function decodeBase64(value: string) {
  const clean = value.replace(/\s/g, "");
  if (clean.length > MAX_ARCHIVE_BYTES * 1.5) throw new Error("EML attachment exceeds the decode limit.");
  const decoded = atob(clean);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function parseEml(text: string) {
  const contentType = /content-type:\s*multipart\/[^;]+;\s*boundary="?([^"\r\n;]+)"?/i.exec(text);
  const pieces = contentType ? text.split(`--${contentType[1] ?? ""}`) : [text];
  const body: string[] = [];
  const attachments: AttachmentInfo[] = [];
  for (const piece of pieces) {
    const split = piece.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const headers = piece.slice(0, split);
    const payload = piece.slice(split).replace(/^\r?\n\r?\n/, "").replace(/\r?\n--$/, "");
    const disposition = /content-disposition:\s*attachment(?:;[\s\S]*?filename\*?="?([^"\r\n;]+)"?)?/i.exec(headers);
    const namedType = /content-type:\s*([^;\r\n]+)(?:;[\s\S]*?name="?([^"\r\n;]+)"?)?/i.exec(headers);
    const name = (disposition?.[1] ?? namedType?.[2])?.trim();
    if (disposition || name) {
      const bytes = /content-transfer-encoding:\s*base64/i.test(headers) ? decodeBase64(payload) : new TextEncoder().encode(payload);
      attachments.push(await attachment(name ?? `attachment-${attachments.length + 1}`, bytes, namedType?.[1]?.trim()));
    } else if (/content-type:\s*text\/(?:plain|html)/i.test(headers) || pieces.length === 1) {
      body.push(/content-transfer-encoding:\s*base64/i.test(headers) ? new TextDecoder().decode(decodeBase64(payload)) : payload.replace(/=\r?\n/g, ""));
    }
  }
  return { text: body.join("\n"), attachments };
}

export async function inspectComplianceFile(file: File): Promise<ComplianceInspection> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("File exceeds the 20 MB limit.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.split(".").pop()?.toLowerCase();
  let text = "";
  let attachments: AttachmentInfo[] = [];
  const findings: GateFinding[] = [];
  if (extension === "eml") {
    const parsed = await parseEml(new TextDecoder().decode(bytes));
    text = parsed.text; attachments = parsed.attachments;
  } else if (extension === "docx") {
    const entries = await readBoundedZip(bytes);
    const document = entries.find((entry) => entry.name === "word/document.xml");
    if (!document) throw new Error("DOCX is missing word/document.xml.");
    text = decodeXml(new TextDecoder().decode(document.bytes));
    const macro = entries.find((entry) => /vbaProject\.bin$/i.test(entry.name));
    if (macro) findings.push({ id: "macro", label: "Office macro project", severity: "critical", detail: "vbaProject.bin is present. Macros were not executed.", evidence: macro.name });
    for (const entry of entries.filter((item) => item.name.startsWith("word/embeddings/"))) attachments.push(await attachment(entry.name, entry.bytes));
    const rels = entries.find((entry) => entry.name === "word/_rels/document.xml.rels");
    if (rels) text += `\n${new TextDecoder().decode(rels.bytes)}`;
  } else if (extension === "pdf") {
    text = await pdfText(bytes);
    if (/\/JavaScript|\/JS\b|\/OpenAction|\/Launch/i.test(new TextDecoder("latin1").decode(bytes))) findings.push({ id: "pdf-active", label: "PDF active-content indicator", severity: "high", detail: "JavaScript, launch, or open-action token found. Content was not executed." });
  } else throw new Error("Choose an EML, DOCX, or PDF file.");
  const links = extractLinks(text);
  findings.push(...textFindings(text), ...linkFindings(links), ...attachments.flatMap((item) => item.findings.map((finding) => ({ ...finding, id: `${item.name}:${finding.id}` }))));
  return {
    name: file.name, type: file.type.length > 0 ? file.type : extension, size: file.size, sha256: await sha256(bytes), inspectedAt: new Date().toISOString(),
    textLength: text.length, links, attachments, findings, textPreview: text.slice(0, 12_000),
    disclaimer: "Heuristic, client-side document inspection only. This is not malware analysis, legal advice, or a compliance certification.",
  };
}

export function complianceReportHtml(report: ComplianceInspection) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Compliance gatekeeper report</title><style>body{font:14px system-ui;max-width:1000px;margin:40px auto;color:#18211d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8dfda;padding:8px;text-align:left}.notice{background:#fff3d8;padding:12px}code{font-family:ui-monospace,monospace}</style><h1>Compliance Gatekeeper report</h1><p class="notice">${escapeHtml(report.disclaimer)}</p><p><strong>${escapeHtml(report.name)}</strong> · ${report.size.toLocaleString()} bytes<br><code>${report.sha256}</code></p><h2>Findings (${report.findings.length})</h2><table><thead><tr><th>Severity</th><th>Signal</th><th>Detail</th><th>Evidence</th></tr></thead><tbody>${report.findings.map((item) => `<tr><td>${item.severity}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.detail)}</td><td>${escapeHtml(item.evidence ?? "")}</td></tr>`).join("") || "<tr><td colspan=4>No configured signals matched.</td></tr>"}</tbody></table><h2>Attachments (${report.attachments.length})</h2><ul>${report.attachments.map((item) => `<li>${escapeHtml(item.name)} · ${item.size.toLocaleString()} bytes · <code>${item.sha256}</code></li>`).join("")}</ul><h2>External links (${report.links.length})</h2><ul>${report.links.map((link) => `<li>${escapeHtml(link)}</li>`).join("")}</ul></html>`;
}
