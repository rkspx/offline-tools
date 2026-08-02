export type CellValue = string | number | boolean | null;

export type QueryResult = {
  columns: string[];
  rows: CellValue[][];
  elapsedMs: number;
  truncated: boolean;
};

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
};

export type TableInfo = {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
};

export type ChartKind = "bar" | "line";

export type ChartPoint = {
  label: string;
  value: number;
};

const FORBIDDEN_SQL = /\b(attach|call|checkpoint|copy|create|delete|detach|drop|export|force\s+install|import|insert|install|load|pragma|reset|set|truncate|update|vacuum)\b/i;
const EXTERNAL_READ = /\b(read_(csv|csv_auto|json|json_auto|ndjson|parquet|blob|text)|httpfs|sqlite_scan|parquet_scan)\s*\(|(?:https?|s3|gcs|azure):\/\//i;

function maskSql(sql: string): string {
  let output = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (!quote && char === "-" && next === "-") {
      const end = sql.indexOf("\n", index + 2);
      output += " ".repeat((end === -1 ? sql.length : end) - index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      const found = sql.indexOf("*/", index + 2);
      const end = found === -1 ? sql.length : found + 2;
      output += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (!quote && (char === "'" || char === '"')) {
      quote = char;
      output += " ";
    } else if (quote && char === quote) {
      if (next === quote) {
        output += "  ";
        index += 2;
        continue;
      }
      quote = null;
      output += " ";
    } else {
      output += quote ? " " : char;
    }
    index += 1;
  }
  return output;
}

export function validateReadOnlySql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("Enter a SQL query.");
  const masked = maskSql(trimmed);
  const statements = masked.split(";").filter((part) => part.trim());
  if (statements.length !== 1) throw new Error("Run one statement at a time.");
  if (!/^\s*(select|with|describe|show|summarize|explain)\b/i.test(masked)) {
    throw new Error("Only read-only SELECT, WITH, DESCRIBE, SHOW, SUMMARIZE, or EXPLAIN queries are allowed.");
  }
  if (FORBIDDEN_SQL.test(masked) || EXTERNAL_READ.test(masked) || /(?:https?|s3|gcs|azure):\/\//i.test(trimmed)) {
    throw new Error("File, network, extension, and data-changing SQL is blocked.");
  }
  return trimmed.replace(/;+\s*$/, "");
}

export function safeTableName(fileName: string, existing: readonly string[] = []): string {
  const stem = fileName.replace(/\.[^.]+$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const base = stem.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "imported_data";
  const prefixed = /^\d/.test(base) ? `data_${base}` : base;
  let candidate = prefixed;
  let suffix = 2;
  const used = new Set(existing.map((name) => name.toLowerCase()));
  while (used.has(candidate.toLowerCase())) {
    candidate = `${prefixed}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function csvCell(value: CellValue): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function resultToCsv(result: QueryResult): string {
  const lines = [
    result.columns.map(csvCell).join(","),
    ...result.rows.map((row) => row.map(csvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function escapeHtml(value: CellValue): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function resultToHtml(result: QueryResult, query: string, sourceName: string): string {
  const header = result.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = result.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Query report</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#17211c;margin:40px}h1{margin:0 0 6px}
p,pre{color:#52615a}pre{background:#f2f6f3;padding:14px;overflow:auto}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dbe4de;padding:8px 10px;text-align:left}
th{background:#edf5f0;position:sticky;top:0}td{font-family:ui-monospace,monospace}
</style></head><body><h1>Local query report</h1><p>${escapeHtml(sourceName)} · ${result.rows.length} rows · ${result.elapsedMs} ms</p>
<pre>${escapeHtml(query)}</pre><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export function chartPoints(result: QueryResult, labelColumn: string, valueColumn: string): ChartPoint[] {
  const labelIndex = result.columns.indexOf(labelColumn);
  const valueIndex = result.columns.indexOf(valueColumn);
  if (labelIndex < 0 || valueIndex < 0) return [];
  return result.rows.slice(0, 50).flatMap((row) => {
    const source = row[valueIndex];
    if (source === null || source === "" || typeof source === "boolean") return [];
    const value = Number(source);
    if (!Number.isFinite(value)) return [];
    return [{ label: String(row[labelIndex] ?? "NULL"), value }];
  });
}
