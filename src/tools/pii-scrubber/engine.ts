import Papa from "papaparse";

export type ColumnAction = "keep" | "redact" | "hash" | "tokenize" | "generalize";
export type FindingKind = "email" | "phone" | "credit-card" | "ip-address" | "date" | "name" | "identifier";

export type CsvData = {
  columns: string[];
  rows: Record<string, string>[];
  warnings: string[];
};

export type ColumnFinding = {
  column: string;
  kinds: FindingKind[];
  matches: number;
  samples: string[];
  suggestedAction: ColumnAction;
};

export type TransformOptions = {
  salt: string;
  tokenMap?: Map<string, string>;
};

const VALUE_PATTERNS: Record<Exclude<FindingKind, "name" | "identifier">, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/i,
  phone: /^(?:\+?\d[\d\s().-]{6,}\d)$/,
  "credit-card": /^(?:\d[ -]*?){13,19}$/,
  "ip-address": /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
  date: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/,
};

const HEADER_HINTS: [RegExp, FindingKind][] = [
  [/(?:^|_)(?:e-?mail)(?:$|_)/i, "email"],
  [/(?:^|_)(?:phone|mobile|tel)(?:$|_)/i, "phone"],
  [/(?:credit.?card|card.?number|pan)/i, "credit-card"],
  [/(?:^|_)(?:ip|ip.?address)(?:$|_)/i, "ip-address"],
  [/(?:birth|dob|date.?of.?birth)/i, "date"],
  [/(?:^|_)(?:name|first.?name|last.?name|full.?name)(?:$|_)/i, "name"],
  [/(?:^|_)(?:ssn|passport|license|customer.?id|user.?id|account.?id)(?:$|_)/i, "identifier"],
];

export function parseCsv(text: string): CsvData {
  if (!text.trim()) throw new Error("Paste CSV data or choose a CSV file.");
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const fatal = result.errors.find((error) => error.type === "Quotes");
  if (fatal) throw new Error(`CSV error on row ${fatal.row === undefined ? "?" : fatal.row + 1}: ${fatal.message}`);
  const columns = result.meta.fields ?? [];
  if (!columns.length || columns.every((column) => !column)) throw new Error("CSV needs a non-empty header row.");
  if (columns.some((column) => !column)) throw new Error("Every CSV column needs a name.");
  if (result.meta.renamedHeaders && Object.keys(result.meta.renamedHeaders).length) {
    throw new Error("CSV column names must be unique.");
  }
  if (new Set(columns).size !== columns.length) throw new Error("CSV column names must be unique.");
  if (!result.data.length) throw new Error("CSV needs at least one data row.");
  const rows = result.data.map((row) => Object.fromEntries(columns.map((column) => {
    const value = row[column];
    if (value === null || value === undefined) return [column, ""];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [column, String(value)];
    }
    throw new Error(`Column "${column}" contains an unsupported value.`);
  })));
  const warnings = result.errors
    .filter((error) => error.type === "FieldMismatch")
    .map((error) => `Row ${(error.row ?? 0) + 2}: ${error.message}`);
  return { columns, rows, warnings };
}

export function inferFindings(data: CsvData): ColumnFinding[] {
  return data.columns.map((column) => {
    const values = data.rows.map((row) => row[column]?.trim() ?? "").filter(Boolean);
    const counts = new Map<FindingKind, number>();
    for (const [pattern, kind] of HEADER_HINTS) {
      if (pattern.test(column)) counts.set(kind, Math.max(1, counts.get(kind) ?? 0));
    }
    for (const value of values) {
      for (const [kind, pattern] of Object.entries(VALUE_PATTERNS) as [keyof typeof VALUE_PATTERNS, RegExp][]) {
        if (pattern.test(value)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    const kinds = [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([kind]) => kind);
    const primary = kinds[0];
    const suggestedAction: ColumnAction = primary === "date" || primary === "ip-address"
      ? "generalize"
      : primary
        ? "redact"
        : "keep";
    return {
      column,
      kinds,
      matches: Math.max(0, ...counts.values()),
      samples: values.slice(0, 3),
      suggestedAction,
    };
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string, salt: string): Promise<string> {
  const input = new TextEncoder().encode(`${salt}\u0000${value}`);
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input)));
}

export function generalizeValue(value: string, kind?: FindingKind): string {
  if (!value) return value;
  if (kind === "email" || VALUE_PATTERNS.email.test(value)) {
    const domain = value.split("@")[1];
    return domain ? `***@${domain}` : "[GENERALIZED]";
  }
  if (kind === "ip-address" || VALUE_PATTERNS["ip-address"].test(value)) {
    return `${value.split(".").slice(0, 3).join(".")}.0/24`;
  }
  if (kind === "date" || VALUE_PATTERNS.date.test(value)) return value.slice(0, 4);
  if (kind === "phone" || VALUE_PATTERNS.phone.test(value)) {
    const digits = value.replace(/\D/g, "");
    return digits.length > 4 ? `***-***-${digits.slice(-4)}` : "[GENERALIZED]";
  }
  if (kind === "name") {
    return value.split(/\s+/).map((part) => part[0]?.toUpperCase()).filter(Boolean).join(".");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    const size = Math.max(10, 10 ** Math.max(1, Math.floor(Math.log10(Math.abs(number) || 1))));
    const start = Math.floor(number / size) * size;
    return `${start}-${start + size - 1}`;
  }
  return value.length <= 3 ? "***" : `${value.slice(0, 2)}…`;
}

export async function scrubRows(
  data: CsvData,
  actions: Record<string, ColumnAction>,
  findings: ColumnFinding[],
  options: TransformOptions,
): Promise<Record<string, string>[]> {
  const tokens = options.tokenMap ?? new Map<string, string>();
  const counters = new Map<string, number>();
  const usedTokens = new Set(tokens.values());
  const primaryKinds = new Map(findings.map((finding) => [finding.column, finding.kinds[0]]));
  return Promise.all(data.rows.map(async (row) => {
    const output: Record<string, string> = {};
    for (const column of data.columns) {
      const value = row[column] ?? "";
      const action = actions[column] ?? "keep";
      if (!value || action === "keep") output[column] = value;
      else if (action === "redact") output[column] = "[REDACTED]";
      else if (action === "hash") output[column] = await sha256(value, options.salt);
      else if (action === "generalize") output[column] = generalizeValue(value, primaryKinds.get(column));
      else {
        const key = `${column}\u0000${value}`;
        let token = tokens.get(key);
        if (!token) {
          const prefix = column.replace(/\W+/g, "_").toUpperCase();
          let next = (counters.get(column) ?? 0) + 1;
          token = `${prefix}_${String(next).padStart(4, "0")}`;
          while (usedTokens.has(token)) {
            next += 1;
            token = `${prefix}_${String(next).padStart(4, "0")}`;
          }
          counters.set(column, next);
          tokens.set(key, token);
          usedTokens.add(token);
        }
        output[column] = token;
      }
    }
    return output;
  }));
}

export function serializeCsv(rows: Record<string, string>[], columns?: string[]): string {
  return Papa.unparse(rows, { columns, newline: "\r\n" });
}
