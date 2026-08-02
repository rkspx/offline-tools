import { diffLines } from "diff";

export const MAX_INPUT = 200_000;
export const MAX_MATCHES = 500;

export type RegexMatch = {
  index: number;
  value: string;
  groups: string[];
};

export type LogRow = {
  line: number;
  timestamp: string;
  level: string;
  message: string;
  fields: Record<string, string>;
};

export type DiffRow = {
  kind: "same" | "added" | "removed";
  value: string;
};

function bounded(input: string): string {
  if (input.length > MAX_INPUT) throw new Error(`Input is limited to ${MAX_INPUT.toLocaleString()} characters.`);
  return input;
}

export function transformJson(input: string, mode: "format" | "minify"): string {
  const value: unknown = JSON.parse(bounded(input));
  return JSON.stringify(value, null, mode === "format" ? 2 : undefined);
}

export function isPotentiallyUnsafeRegex(pattern: string): boolean {
  return /(\([^)]*[+*][^)]*\)|\[[^\]]+\][+*]|\.[+*])(?:[+*]|\{\d*,?\d*\})/.test(pattern);
}

export function runRegex(pattern: string, flags: string, input: string): RegexMatch[] {
  bounded(input);
  if (!pattern) return [];
  if (pattern.length > 500) throw new Error("Patterns are limited to 500 characters.");
  if (isPotentiallyUnsafeRegex(pattern)) {
    throw new Error("This pattern contains nested repetition and may freeze the browser. Simplify it first.");
  }
  const safeFlags = [...new Set(flags)].join("");
  if (/[^dgimsuvy]/.test(safeFlags)) throw new Error("Use only JavaScript regex flags: d g i m s u v y.");
  const regex = new RegExp(pattern, safeFlags.includes("g") ? safeFlags : `${safeFlags}g`);
  const matches: RegexMatch[] = [];
  for (const match of input.matchAll(regex)) {
    matches.push({
      index: match.index,
      value: match[0],
      groups: match.slice(1),
    });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

function typeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, " ").replace(/(?:^|\s)(\w)/g, (_, char: string) => char.toUpperCase()).replace(/\s/g, "");
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `Type${cleaned}`;
}

function propertyName(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

export function jsonToTypeScript(input: string, rootName = "Root"): string {
  const value: unknown = JSON.parse(bounded(input));
  const declarations: string[] = [];
  const seen = new Set<string>();

  const infer = (item: unknown, name: string): string => {
    if (item === null) return "null";
    if (Array.isArray(item)) {
      if (item.length === 0) return "unknown[]";
      const types = [...new Set(item.slice(0, 100).map((entry) => infer(entry, `${name}Item`)))];
      return `Array<${types.join(" | ")}>`;
    }
    if (typeof item !== "object") return typeof item;
    const interfaceName = typeName(name);
    if (!seen.has(interfaceName)) {
      seen.add(interfaceName);
      const body = Object.entries(item as Record<string, unknown>)
        .map(([key, child]) => `  ${propertyName(key)}: ${infer(child, `${interfaceName}${typeName(key)}`)};`)
        .join("\n");
      declarations.push(`export interface ${interfaceName} {\n${body}\n}`);
    }
    return interfaceName;
  };

  const rootType = infer(value, rootName);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return declarations.reverse().join("\n\n");
  return `${declarations.reverse().join("\n\n")}${declarations.length ? "\n\n" : ""}export type ${typeName(rootName)} = ${rootType};`;
}

export function parseLogs(input: string): LogRow[] {
  bounded(input);
  return input.split(/\r?\n/).filter(Boolean).slice(0, 2_000).map((raw, index) => {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const scalar = (value: unknown, fallback = "") => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : fallback;
      const timestamp = scalar(json.timestamp ?? json.time ?? json.date);
      const level = scalar(json.level ?? json.severity).toUpperCase();
      const message = scalar(json.message ?? json.msg, raw);
      const fields = Object.fromEntries(Object.entries(json)
        .filter(([key]) => !["timestamp", "time", "date", "level", "severity", "message", "msg"].includes(key))
        .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
      return { line: index + 1, timestamp, level, message, fields };
    } catch {
      const match = /^\s*(?:\[?(\d{4}-\d\d-\d\d[T ][^\]\s]+)\]?\s*)?(?:\[?([A-Za-z]+)\]?\s*[:\-]?\s*)?(.*)$/.exec(raw);
      const message = match?.[3] ?? raw;
      const fields: Record<string, string> = {};
      const fieldPattern = /\b([\w.-]+)=("[^"]*"|'[^']*'|[^\s]+)/g;
      let pair: RegExpExecArray | null;
      while ((pair = fieldPattern.exec(message)) !== null) {
        const key = pair[1];
        const fieldValue = pair[2];
        if (key !== undefined && fieldValue !== undefined) fields[key] = fieldValue.replace(/^["']|["']$/g, "");
      }
      return {
        line: index + 1,
        timestamp: match?.[1] ?? "",
        level: /^(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)$/i.test(match?.[2] ?? "") ? (match?.[2] ?? "").toUpperCase() : "",
        message,
        fields,
      };
    }
  });
}

export function compareText(before: string, after: string): DiffRow[] {
  bounded(before);
  bounded(after);
  return diffLines(before, after).flatMap((part) => {
    const kind = part.added ? "added" : part.removed ? "removed" : "same";
    return part.value.replace(/\n$/, "").split("\n").map((value) => ({ kind, value }));
  });
}
