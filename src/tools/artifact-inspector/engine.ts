import { compileAndScan, type ScanResult } from "../security-shared/yara";
import { escapeHtml, hexPreview, sha256, textPreview } from "../security-shared/utils";

export const CURATED_ARTIFACT_RULES = `rule Executable_Header : format {
  meta:
    description = "Windows executable MZ header"
    severity = "info"
  strings:
    $mz = { 4D 5A }
  condition:
    $mz and uint16(0) == 23117
}

rule Script_Downloader_Indicators : behavior {
  meta:
    description = "Command and network download terms occur together"
    severity = "medium"
  strings:
    $shell = /(?:powershell|cmd\\.exe|\\/bin\\/(?:ba)?sh)/ nocase
    $download = /(?:invoke-webrequest|curl\\s|wget\\s|downloadstring)/ nocase
  condition:
    all of them
}

rule Suspicious_Encoded_Command : script {
  meta:
    description = "Encoded-command style invocation"
    severity = "medium"
  strings:
    $encoded = /-(?:enc|encodedcommand)\\s+[A-Za-z0-9+\\/=]{20,}/ nocase
  condition:
    $encoded
}

rule Office_Macro_Container : document {
  meta:
    description = "Office VBA project stream name"
    severity = "high"
  strings:
    $vba = "vbaProject.bin" ascii wide nocase
  condition:
    $vba
}`;

export type ArtifactReport = {
  name: string;
  size: number;
  type: string;
  sha256: string;
  createdAt: string;
  disclaimer: string;
  scan: ScanResult;
  hex: string;
  text: string;
};

export async function inspectArtifact(file: File): Promise<ArtifactReport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scan = compileAndScan(CURATED_ARTIFACT_RULES, bytes);
  return {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    sha256: await sha256(bytes),
    createdAt: new Date().toISOString(),
    disclaimer: "Heuristic local inspection only. This is not an antivirus verdict and may miss harmful content.",
    scan,
    hex: hexPreview(bytes),
    text: textPreview(bytes),
  };
}

export function artifactReportHtml(report: ArtifactReport): string {
  const matches = report.scan.rules.filter((rule) => rule.matched);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Artifact inspection</title>
<style>body{font:14px system-ui;max-width:900px;margin:40px auto;color:#18221d}code,pre{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd6cf;padding:8px;text-align:left}.notice{padding:12px;background:#fff4d6;border-left:4px solid #b97900}</style>
<h1>Artifact inspection report</h1><p class="notice">${escapeHtml(report.disclaimer)}</p>
<dl><dt>File</dt><dd>${escapeHtml(report.name)}</dd><dt>Size</dt><dd>${report.size.toLocaleString()} bytes</dd><dt>SHA-256</dt><dd><code>${report.sha256}</code></dd><dt>Engine</dt><dd>${escapeHtml(report.scan.engine)}</dd></dl>
<h2>Matched heuristic rules (${matches.length})</h2><table><thead><tr><th>Rule</th><th>Severity</th><th>Description</th><th>Offsets</th></tr></thead><tbody>${matches.map((rule) => `<tr><td>${escapeHtml(rule.rule)}</td><td>${escapeHtml(rule.meta.severity ?? "")}</td><td>${escapeHtml(rule.meta.description ?? "")}</td><td>${rule.matches.map((item) => `0x${item.offset.toString(16)}`).join(", ")}</td></tr>`).join("") || "<tr><td colspan=4>No configured indicators matched.</td></tr>"}</tbody></table>
<h2>Hex preview</h2><pre>${escapeHtml(report.hex)}</pre></html>`;
}
