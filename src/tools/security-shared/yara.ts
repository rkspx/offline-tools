export const YARA_SUBSET_LABEL = "YARA-compatible browser subset (not libyara)";
export const MAX_SCAN_BYTES = 20 * 1024 * 1024;

export type YaraString = {
  id: string;
  kind: "text" | "hex" | "regex";
  source: string;
  modifiers: string[];
  line: number;
};

export type YaraRule = {
  name: string;
  tags: string[];
  meta: Record<string, string | number | boolean>;
  strings: YaraString[];
  condition: string;
};

export type YaraDiagnostic = { line: number; message: string };
export type StringMatch = { id: string; offset: number; length: number; preview: string };
export type RuleResult = {
  rule: string;
  tags: string[];
  meta: YaraRule["meta"];
  matched: boolean;
  matches: StringMatch[];
  elapsedMs: number;
};

export type ScanResult = {
  engine: typeof YARA_SUBSET_LABEL;
  byteLength: number;
  elapsedMs: number;
  rules: RuleResult[];
};

function lineAt(source: string, offset: number) {
  return source.slice(0, offset).split("\n").length;
}

function findClosingBrace(source: string, open: number): number {
  let depth = 0;
  let quote = "";
  let regex = false;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (escaped) { escaped = false; continue; }
    if ((quote || regex) && char === "\\") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (regex) { if (char === "/") regex = false; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "/" && source[index - 1] === "=") { regex = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function decodeQuoted(value: string): string {
  return value.replace(/\\(x[0-9a-f]{2}|n|r|t|\\|")/gi, (_, token: string) => {
    if (token[0]?.toLowerCase() === "x") return String.fromCharCode(Number.parseInt(token.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' } as Record<string, string>)[token] ?? token;
  });
}

function parseMeta(section: string, lineOffset: number, diagnostics: YaraDiagnostic[]) {
  const meta: YaraRule["meta"] = {};
  section.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) return;
    const match = /^([A-Za-z_]\w*)\s*=\s*(?:"((?:\\.|[^"])*)"|(-?\d+(?:\.\d+)?)|(true|false))\s*$/.exec(line);
    if (!match) diagnostics.push({ line: lineOffset + index, message: `Invalid metadata: ${line}` });
    else if (match[2] !== undefined) meta[match[1] ?? ""] = decodeQuoted(match[2]);
    else if (match[3] !== undefined) meta[match[1] ?? ""] = Number(match[3]);
    else meta[match[1] ?? ""] = match[4] === "true";
  });
  return meta;
}

function parseStrings(section: string, lineOffset: number, diagnostics: YaraDiagnostic[]): YaraString[] {
  const strings: YaraString[] = [];
  section.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) return;
    const base = /^\$([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
    if (!base) { diagnostics.push({ line: lineOffset + index, message: `Invalid string declaration: ${line}` }); return; }
    const id = `$${base[1] ?? ""}`;
    const value = base[2] ?? "";
    let match = /^"((?:\\.|[^"])*)"\s*(.*)$/.exec(value);
    if (match) {
      const modifiers = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);
      const unsupported = modifiers.filter((item) => !["ascii", "wide", "nocase", "fullword"].includes(item));
      if (unsupported.length) diagnostics.push({ line: lineOffset + index, message: `Unsupported modifier(s): ${unsupported.join(", ")}` });
      strings.push({ id, kind: "text", source: decodeQuoted(match[1] ?? ""), modifiers, line: lineOffset + index });
      return;
    }
    match = /^\{([^}]*)\}\s*$/.exec(value);
    if (match) {
      const tokens = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
      if (!tokens.length || tokens.some((token) => !/^(?:[0-9a-f]{2}|\?\?)$/i.test(token))) {
        diagnostics.push({ line: lineOffset + index, message: "Hex strings support byte pairs and ?? wildcards only." });
      } else strings.push({ id, kind: "hex", source: tokens.join(" "), modifiers: [], line: lineOffset + index });
      return;
    }
    match = /^\/((?:\\.|[^/])*)\/([ims]*)\s*(.*)$/.exec(value);
    if (match) {
      const modifiers = (match[3] ?? "").trim().split(/\s+/).filter(Boolean);
      try { new RegExp(match[1] ?? "", match[2] ?? ""); } catch { diagnostics.push({ line: lineOffset + index, message: "Invalid regular expression." }); }
      if (modifiers.some((item) => !["ascii", "wide", "nocase", "fullword"].includes(item))) diagnostics.push({ line: lineOffset + index, message: "Unsupported regex modifier." });
      strings.push({ id, kind: "regex", source: `/${match[1] ?? ""}/${match[2] ?? ""}`, modifiers, line: lineOffset + index });
      return;
    }
    diagnostics.push({ line: lineOffset + index, message: "Expected a quoted text, hex, or regex string." });
  });
  return strings;
}

export function parseYara(source: string): { rules: YaraRule[]; diagnostics: YaraDiagnostic[] } {
  const rules: YaraRule[] = [];
  const diagnostics: YaraDiagnostic[] = [];
  const header = /\brule\s+([A-Za-z_]\w*)(?:\s*:\s*([^{]+?))?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(source))) {
    const open = header.lastIndex - 1;
    const close = findClosingBrace(source, open);
    if (close < 0) { diagnostics.push({ line: lineAt(source, open), message: `Rule ${match[1]} is missing a closing brace.` }); break; }
    const body = source.slice(open + 1, close);
    const conditionIndex = body.search(/\bcondition\s*:/i);
    if (conditionIndex < 0) {
      diagnostics.push({ line: lineAt(source, open), message: `Rule ${match[1]} needs a condition section.` });
      header.lastIndex = close + 1;
      continue;
    }
    const stringsIndex = body.search(/\bstrings\s*:/i);
    const metaIndex = body.search(/\bmeta\s*:/i);
    const sectionEnd = (start: number) => [metaIndex, stringsIndex, conditionIndex].filter((value) => value > start).sort((a, b) => a - b)[0] ?? body.length;
    const getSection = (start: number) => {
      if (start < 0) return "";
      const colon = body.indexOf(":", start);
      return body.slice(colon + 1, sectionEnd(start));
    };
    const absoluteBodyLine = lineAt(source, open + 1);
    const metaText = getSection(metaIndex);
    const stringsText = getSection(stringsIndex);
    const condition = getSection(conditionIndex).replace(/\/\/.*$/gm, "").trim();
    const meta = parseMeta(metaText, absoluteBodyLine + (metaIndex < 0 ? 0 : body.slice(0, metaIndex).split("\n").length), diagnostics);
    const strings = parseStrings(stringsText, absoluteBodyLine + (stringsIndex < 0 ? 0 : body.slice(0, stringsIndex).split("\n").length), diagnostics);
    if (!condition) diagnostics.push({ line: absoluteBodyLine, message: `Rule ${match[1]} has an empty condition.` });
    rules.push({ name: match[1] ?? "", tags: (match[2] ?? "").trim().split(/\s+/).filter(Boolean), meta, strings, condition });
    header.lastIndex = close + 1;
  }
  if (!rules.length && !diagnostics.length) diagnostics.push({ line: 1, message: "No rules found." });
  const names = new Set<string>();
  for (const rule of rules) {
    if (names.has(rule.name)) diagnostics.push({ line: 1, message: `Duplicate rule name: ${rule.name}` });
    names.add(rule.name);
    for (const ref of rule.condition.match(/\$[A-Za-z_]\w*/g) ?? []) {
      if (!rule.strings.some((item) => item.id === ref)) diagnostics.push({ line: 1, message: `Unknown string reference ${ref} in ${rule.name}.` });
    }
  }
  return { rules, diagnostics };
}

function bytePreview(bytes: Uint8Array, offset: number, length: number) {
  return [...bytes.slice(offset, offset + Math.min(length, 24))]
    .map((byte) => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".").join("");
}

function findBytes(haystack: Uint8Array, needle: (number | null)[], nocase = false): { offset: number; length: number }[] {
  const found: { offset: number; length: number }[] = [];
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      const expected = needle[index];
      if (expected === null || expected === undefined) continue;
      const actual = haystack[offset + index] ?? -1;
      if (actual === expected) continue;
      const actualLower = actual >= 65 && actual <= 90 ? actual + 32 : actual;
      const expectedLower = expected >= 65 && expected <= 90 ? expected + 32 : expected;
      if (nocase && actualLower === expectedLower) continue;
      continue outer;
    }
    found.push({ offset, length: needle.length });
    if (found.length >= 1000) break;
  }
  return found;
}

function isAsciiAlphanumeric(value: number | undefined): boolean {
  return value !== undefined
    && ((value >= 48 && value <= 57) || (value >= 65 && value <= 90) || (value >= 97 && value <= 122));
}

function hasFullwordBoundaries(
  bytes: Uint8Array,
  match: { offset: number; length: number },
  wide: boolean,
): boolean {
  if (!wide) {
    return !isAsciiAlphanumeric(bytes[match.offset - 1])
      && !isAsciiAlphanumeric(bytes[match.offset + match.length]);
  }

  const codeUnitAt = (offset: number): number | undefined => {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    return low === undefined || high === undefined ? undefined : low | (high << 8);
  };
  return !isAsciiAlphanumeric(codeUnitAt(match.offset - 2))
    && !isAsciiAlphanumeric(codeUnitAt(match.offset + match.length));
}

function matchString(item: YaraString, bytes: Uint8Array): StringMatch[] {
  let raw: { offset: number; length: number }[] = [];
  const fullword = item.modifiers.includes("fullword");
  if (item.kind === "hex") {
    raw = findBytes(bytes, item.source.split(/\s+/).map((token) => token === "??" ? null : Number.parseInt(token, 16)));
  } else if (item.kind === "text") {
    const ascii = [...new TextEncoder().encode(item.source)];
    const wide = Array.from(item.source).flatMap((char) => [char.charCodeAt(0) & 255, char.charCodeAt(0) >> 8]);
    if (!item.modifiers.includes("wide") || item.modifiers.includes("ascii")) {
      const matches = findBytes(bytes, ascii, item.modifiers.includes("nocase"));
      raw.push(...(fullword ? matches.filter((candidate) => hasFullwordBoundaries(bytes, candidate, false)) : matches));
    }
    if (item.modifiers.includes("wide")) {
      const matches = findBytes(bytes, wide, item.modifiers.includes("nocase"));
      raw.push(...(fullword ? matches.filter((candidate) => hasFullwordBoundaries(bytes, candidate, true)) : matches));
    }
  } else {
    const end = item.source.lastIndexOf("/");
    const pattern = item.source.slice(1, end);
    let flags = item.source.slice(end + 1).replace("y", "");
    if (!flags.includes("g")) flags += "g";
    if (item.modifiers.includes("nocase") && !flags.includes("i")) flags += "i";
    const text = new TextDecoder("latin1").decode(bytes);
    const regex = new RegExp(pattern, flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) && raw.length < 1000) {
      raw.push({ offset: match.index, length: Math.max(1, match[0].length) });
      if (!match[0].length) regex.lastIndex += 1;
    }
    if (fullword) raw = raw.filter((candidate) => hasFullwordBoundaries(bytes, candidate, false));
  }
  return raw.map((match) => ({ id: item.id, ...match, preview: bytePreview(bytes, match.offset, match.length) }));
}

type Token = { type: "word" | "number" | "ref" | "op" | "paren"; value: string };

function conditionTokens(value: string): Token[] {
  const tokens: Token[] = [];
  const regex = /\s*(\$[A-Za-z_]\w*|\d+(?:KB|MB)?|uint(?:8|16|32)\s*\(\s*\d+\s*\)|filesize|true|false|any|all|of|them|and|or|not|==|!=|<=|>=|<|>|\(|\))/igy;
  let offset = 0;
  while (offset < value.length) {
    regex.lastIndex = offset;
    const match = regex.exec(value);
    if (!match) throw new Error(`Unsupported condition near "${value.slice(offset, offset + 20)}".`);
    const token = match[1] ?? "";
    offset = regex.lastIndex;
    tokens.push({
      type: token.startsWith("$") ? "ref" : /^\d/.test(token) ? "number" : /^[()]$/.test(token) ? "paren" : /^(?:==|!=|<=|>=|<|>)$/.test(token) ? "op" : "word",
      value: token,
    });
  }
  return tokens;
}

function readUint(bytes: Uint8Array, bits: number, offset: number) {
  const size = bits / 8;
  if (offset < 0 || offset + size > bytes.length) return -1;
  let value = 0;
  for (let index = 0; index < size; index += 1) value += (bytes[offset + index] ?? 0) * 2 ** (8 * index);
  return value;
}

function evaluateCondition(condition: string, hits: Map<string, number>, bytes: Uint8Array): boolean {
  const tokens = conditionTokens(condition);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const numeric = (token: Token): number => {
    if (/^\d+(?:KB|MB)?$/i.test(token.value)) {
      const unit = token.value.toUpperCase().endsWith("MB") ? 1024 * 1024 : token.value.toUpperCase().endsWith("KB") ? 1024 : 1;
      return Number.parseInt(token.value, 10) * unit;
    }
    if (token.value.toLowerCase() === "filesize") return bytes.length;
    const uint = /^uint(8|16|32)\s*\(\s*(\d+)\s*\)$/i.exec(token.value);
    if (uint) return readUint(bytes, Number(uint[1]), Number(uint[2]));
    throw new Error(`Expected a number, got ${token.value}.`);
  };
  const primary = (): boolean => {
    const token = take();
    if (!token) throw new Error("Unexpected end of condition.");
    if (token.value === "(") {
      const value = or();
      if (take()?.value !== ")") throw new Error("Missing closing parenthesis.");
      return value;
    }
    if (token.value.toLowerCase() === "true") return true;
    if (token.value.toLowerCase() === "false") return false;
    if (token.type === "ref") return (hits.get(token.value) ?? 0) > 0;
    if (/^(any|all)$/i.test(token.value) || token.type === "number") {
      const next = tokens[position];
      if (next?.value.toLowerCase() === "of") {
        position += 1;
        if (take()?.value.toLowerCase() !== "them") throw new Error("Only 'of them' sets are supported.");
        const count = [...hits.values()].filter((value) => value > 0).length;
        return token.value.toLowerCase() === "any" ? count > 0 : token.value.toLowerCase() === "all" ? count === hits.size : count >= Number(token.value);
      }
    }
    const left = numeric(token);
    const operator = take();
    const right = take();
    if (operator?.type !== "op" || !right) throw new Error("Expected a comparison.");
    const rightValue = numeric(right);
    return ({ "==": left === rightValue, "!=": left !== rightValue, "<": left < rightValue, ">": left > rightValue, "<=": left <= rightValue, ">=": left >= rightValue })[operator.value] ?? false;
  };
  const unary = (): boolean => peek()?.value.toLowerCase() === "not" ? (take(), !unary()) : primary();
  const and = (): boolean => {
    let value = unary();
    while (peek()?.value.toLowerCase() === "and") { take(); const right = unary(); value = value && right; }
    return value;
  };
  const or = (): boolean => {
    let value = and();
    while (peek()?.value.toLowerCase() === "or") { take(); const right = and(); value = value || right; }
    return value;
  };
  const result = or();
  if (position !== tokens.length) throw new Error(`Unexpected token ${tokens[position]?.value}.`);
  return result;
}

export function scanBytes(rules: YaraRule[], bytes: Uint8Array, now: () => number = () => performance.now()): ScanResult {
  if (bytes.byteLength > MAX_SCAN_BYTES) throw new Error("Input exceeds the 20 MB scan limit.");
  const totalStart = now();
  const results = rules.map((rule) => {
    const start = now();
    const matches = rule.strings.flatMap((item) => matchString(item, bytes)).sort((a, b) => a.offset - b.offset);
    const hits = new Map(rule.strings.map((item) => [item.id, matches.filter((match) => match.id === item.id).length]));
    return { rule: rule.name, tags: rule.tags, meta: rule.meta, matched: evaluateCondition(rule.condition, hits, bytes), matches, elapsedMs: Math.max(0, now() - start) };
  });
  return { engine: YARA_SUBSET_LABEL, byteLength: bytes.byteLength, elapsedMs: Math.max(0, now() - totalStart), rules: results };
}

export function compileAndScan(source: string, bytes: Uint8Array): ScanResult {
  const parsed = parseYara(source);
  if (parsed.diagnostics.length) throw new Error(parsed.diagnostics.map((item) => `Line ${item.line}: ${item.message}`).join("\n"));
  return scanBytes(parsed.rules, bytes);
}

export const SAMPLE_RULES = `rule Suspicious_PowerShell : script {
  meta:
    description = "Encoded PowerShell invocation"
    severity = "medium"
  strings:
    $ps = "powershell" ascii wide nocase
    $encoded = /-(?:enc|encodedcommand)\\s+[A-Za-z0-9+\\/=]{16,}/ nocase
  condition:
    all of them and filesize < 2MB
}

rule Portable_Executable : format {
  meta:
    description = "DOS MZ header"
    severity = "info"
  strings:
    $mz = { 4D 5A }
  condition:
    $mz and uint16(0) == 23117
}`;
