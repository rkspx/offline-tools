import { escapeHtml, readBoundedZip } from "../security-shared/utils";

export type Severity = "high" | "medium" | "low";
export type LeakRule = { id: string; label: string; category: "credential" | "pii" | "custom" | "entropy"; severity: Severity; pattern: RegExp };
export type LeakFinding = {
  id: string; ruleId: string; label: string; category: LeakRule["category"]; severity: Severity;
  source: string; line: number; column: number; masked: string; context: string;
};
export type LeakScan = { createdAt: string; sources: number; characters: number; findings: LeakFinding[]; notes: string[] };
export type CustomLeakRule = { name: string; pattern: string; flags?: string; severity: Severity };

const RULES: LeakRule[] = [
  { id: "aws-access-key", label: "AWS access key ID", category: "credential", severity: "high", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "github-token", label: "GitHub token", category: "credential", severity: "high", pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{30,255}\b/g },
  { id: "private-key", label: "Private key header", category: "credential", severity: "high", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: "jwt", label: "JSON Web Token", category: "credential", severity: "medium", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: "assignment-secret", label: "Secret-like assignment", category: "credential", severity: "medium", pattern: /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?([^\s"',;]{8,})/gi },
  { id: "email", label: "Email address", category: "pii", severity: "low", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: "us-ssn", label: "US Social Security number", category: "pii", severity: "high", pattern: /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g },
  { id: "credit-card", label: "Payment card candidate", category: "pii", severity: "high", pattern: /\b(?:\d[ -]*?){13,19}\b/g },
  { id: "ipv4", label: "IPv4 address", category: "pii", severity: "low", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

function luhn(value: string) {
  const digits = value.replace(/\D/g, "");
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    double = !double;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

function mask(value: string) {
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 3)}${"•".repeat(Math.min(12, value.length - 6))}${value.slice(-3)}`;
}

function location(text: string, offset: number) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function entropy(value: string) {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function customRules(custom: CustomLeakRule[]): LeakRule[] {
  return custom.map((rule, index) => {
    if (!rule.name.trim()) throw new Error(`Custom rule ${index + 1} needs a name.`);
    let pattern: RegExp;
    try { pattern = new RegExp(rule.pattern, `${rule.flags?.replace(/[^imsu]/g, "") ?? ""}g`); }
    catch { throw new Error(`Custom rule "${rule.name}" has an invalid regular expression.`); }
    return { id: `custom-${index}`, label: rule.name, category: "custom", severity: rule.severity, pattern };
  });
}

export function scanText(text: string, source = "pasted-text", custom: CustomLeakRule[] = [], entropyEnabled = true): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const sensitiveValues: string[] = [];
  const activeRules = [...RULES, ...customRules(custom)];
  for (const rule of activeRules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) && findings.length < 5000) {
      const value = match[0];
      if (rule.id === "credit-card" && !luhn(value)) continue;
      if (rule.id === "assignment-secret" && /^(?:example|sample|changeme|placeholder|your[_-]|test)/i.test(match[1] ?? "")) continue;
      sensitiveValues.push(value);
      if (match[1]) sensitiveValues.push(match[1]);
      const point = location(text, match.index);
      findings.push({
        id: `${source}:${rule.id}:${match.index}`, ruleId: rule.id, label: rule.label, category: rule.category,
        severity: rule.severity, source, ...point, masked: mask(value),
        context: text.slice(Math.max(0, match.index - 28), Math.min(text.length, match.index + value.length + 28)).replace(value, mask(value)).replace(/\s+/g, " "),
      });
      if (!value.length) regex.lastIndex += 1;
    }
  }
  if (entropyEnabled) {
    const candidates = /\b[A-Za-z0-9+/=_-]{24,120}\b/g;
    let match: RegExpExecArray | null;
    while ((match = candidates.exec(text)) && findings.length < 5000) {
      const value = match[0];
      if (entropy(value) < 4.15 || /^(?:[a-f0-9]{32,64}|[A-Z_]+)$/i.test(value) || value.includes("placeholder")) continue;
      if (findings.some((item) => item.source === source && item.id.endsWith(`:${match?.index ?? -1}`))) continue;
      sensitiveValues.push(value);
      const point = location(text, match.index);
      findings.push({ id: `${source}:entropy:${match.index}`, ruleId: "entropy", label: "High-entropy token", category: "entropy", severity: "medium", source, ...point, masked: mask(value), context: text.slice(Math.max(0, match.index - 28), match.index + value.length + 28).replace(value, mask(value)).replace(/\s+/g, " ") });
    }
  }
  const sanitized = findings.map((finding) => {
    let context = finding.context;
    for (const value of [...new Set(sensitiveValues)].sort((a, b) => b.length - a.length)) context = context.replaceAll(value, mask(value));
    for (const rule of activeRules) {
      const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
      context = context.replace(new RegExp(rule.pattern.source, flags), (value) => mask(value));
    }
    if (entropyEnabled) context = context.replace(/\b[A-Za-z0-9+/=_-]{24,120}\b/g, (value) => entropy(value) >= 4.15 ? mask(value) : value);
    return { ...finding, context };
  });
  return sanitized.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]);
}

function probablyText(bytes: Uint8Array) {
  const sample = bytes.slice(0, 2048);
  if (!sample.length) return true;
  return [...sample].filter((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32).length / sample.length > 0.85;
}

export async function scanFiles(files: File[], custom: CustomLeakRule[] = [], entropyEnabled = true): Promise<LeakScan> {
  const findings: LeakFinding[] = [];
  const notes: string[] = [];
  let characters = 0;
  let sources = 0;
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) { notes.push(`${file.name}: skipped (over 20 MB)`); continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = file.name.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    const entries = isZip ? await readBoundedZip(bytes) : [{ name: file.name, bytes }];
    for (const entry of entries) {
      if (!probablyText(entry.bytes)) { notes.push(`${entry.name}: skipped binary content`); continue; }
      const text = new TextDecoder().decode(entry.bytes);
      characters += text.length;
      sources += 1;
      findings.push(...scanText(text, isZip ? `${file.name}/${entry.name}` : file.name, custom, entropyEnabled));
    }
  }
  return { createdAt: new Date().toISOString(), sources, characters, findings: findings.slice(0, 5000), notes };
}

export function leakReportHtml(report: LeakScan): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Leak scan report</title><style>body{font:14px system-ui;max-width:1000px;margin:40px auto;color:#18211d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d7dfda;padding:8px;text-align:left}.notice{background:#fff3d6;padding:12px}code{font-family:ui-monospace,monospace}</style><h1>Credential & PII leak report</h1><p class="notice">Heuristic local scan. Findings are masked, may include false positives, and are not a compliance certification.</p><p>${report.findings.length} findings across ${report.sources} text sources.</p><table><thead><tr><th>Severity</th><th>Finding</th><th>Location</th><th>Masked evidence</th></tr></thead><tbody>${report.findings.map((item) => `<tr><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.source)}:${item.line}:${item.column}</td><td><code>${escapeHtml(item.context)}</code></td></tr>`).join("") || "<tr><td colspan=4>No configured patterns matched.</td></tr>"}</tbody></table></html>`;
}
