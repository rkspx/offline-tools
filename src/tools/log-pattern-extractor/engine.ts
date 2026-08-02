export const MAX_LOG_INPUT = 300_000;
export const MAX_ROWS = 3_000;

export type PatternRule = {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  enabled: boolean;
};

export type ExtractedRow = {
  line: number;
  source: string;
  timestamp: string;
  level: string;
  ip: string;
  uuid: string;
  stackTrace: string;
  custom: Record<string, string>;
};

export const BUILTIN_RULES = {
  timestamp: /\b(?:\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}\/[A-Za-z]{3}\/\d{4}:[0-2]\d:[0-5]\d:[0-5]\d [+-]\d{4})\b/i,
  level: /\b(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|CRITICAL|FATAL)\b/i,
  ip: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b|(?<![\w:])(?:[a-f\d]{1,4}:){2,7}[a-f\d]{0,4}(?![\w:])/i,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
} as const;

export function validateRule(rule: PatternRule): string | null {
  if (!rule.name.trim()) return "Give this rule a name.";
  if (!rule.pattern) return "Enter a regex pattern.";
  if (rule.pattern.length > 500) return "Patterns are limited to 500 characters.";
  if (/(\([^)]*[+*][^)]*\)|\[[^\]]+\][+*]|\.[+*])(?:[+*]|\{\d*,?\d*\})/.test(rule.pattern)) {
    return "Nested repetition may freeze the browser.";
  }
  if (/[^imsu]/.test(rule.flags)) return "Custom rules support i, m, s, and u flags.";
  try {
    new RegExp(rule.pattern, rule.flags);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regular expression.";
  }
}

function matchValue(expression: RegExp, value: string): string {
  const match = expression.exec(value);
  return match?.[1] ?? match?.[0] ?? "";
}

export function extractLogPatterns(input: string, rules: PatternRule[]): ExtractedRow[] {
  if (input.length > MAX_LOG_INPUT) throw new Error(`Input is limited to ${MAX_LOG_INPUT.toLocaleString()} characters.`);
  const activeRules = rules.filter((rule) => rule.enabled);
  for (const rule of activeRules) {
    const error = validateRule(rule);
    if (error) throw new Error(`${rule.name || "Custom rule"}: ${error}`);
  }
  const compiled = activeRules.map((rule) => ({ ...rule, expression: new RegExp(rule.pattern, rule.flags) }));
  const lines = input.split(/\r?\n/).slice(0, MAX_ROWS);
  const rows: ExtractedRow[] = [];
  let stackBuffer: string[] = [];
  let stackOwner = -1;

  lines.forEach((source, index) => {
    const isStackLine = /^\s+(?:at\s+|File\s+".+", line \d+|Caused by:|\.{3} \d+ more)/.test(source);
    if (isStackLine && stackOwner >= 0) {
      stackBuffer.push(source.trim());
      const owner = rows[stackOwner];
      if (owner) owner.stackTrace = stackBuffer.join("\n");
      return;
    }
    stackBuffer = [];
    stackOwner = -1;
    if (!source.trim()) return;
    const row: ExtractedRow = {
      line: index + 1,
      source,
      timestamp: matchValue(BUILTIN_RULES.timestamp, source),
      level: matchValue(BUILTIN_RULES.level, source).toUpperCase(),
      ip: matchValue(BUILTIN_RULES.ip, source),
      uuid: matchValue(BUILTIN_RULES.uuid, source),
      stackTrace: "",
      custom: Object.fromEntries(compiled.map((rule) => [rule.name, matchValue(rule.expression, source)])),
    };
    rows.push(row);
    if (/\b(?:error|exception|traceback)\b/i.test(source)) {
      stackOwner = rows.length - 1;
      stackBuffer = [source.trim()];
      row.stackTrace = stackBuffer[0] ?? "";
    }
  });
  return rows;
}

function exportableRows(rows: ExtractedRow[]): Record<string, string | number>[] {
  return rows.map((row) => ({
    line: row.line,
    source: row.source,
    timestamp: row.timestamp,
    level: row.level,
    ip: row.ip,
    uuid: row.uuid,
    stackTrace: row.stackTrace,
    ...row.custom,
  }));
}

export function rowsToJson(rows: ExtractedRow[]): string {
  return JSON.stringify(exportableRows(rows), null, 2);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: ExtractedRow[]): string {
  const values = exportableRows(rows);
  if (values.length === 0) return "";
  const columns = [...new Set(values.flatMap((row) => Object.keys(row)))];
  return [columns.join(","), ...values.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","))].join("\n");
}
