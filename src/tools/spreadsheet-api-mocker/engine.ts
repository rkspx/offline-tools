import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ApiRow = Record<string, unknown>;

export type MockConfig = {
  route: string;
  idField: string;
  sheetName: string;
};

export type MockResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
};

export type ImportedWorkbook = {
  sheets: Record<string, ApiRow[]>;
  names: string[];
};

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function normalizeRoute(route: string): string {
  const clean = route.trim().replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0] ?? "";
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  return (withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/api/items");
}

export function parseCsv(text: string): ApiRow[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
    dynamicTyping: true,
  });
  if (result.errors.length) throw new Error(result.errors[0]?.message ?? "Could not parse CSV.");
  if (!result.meta.fields?.length) throw new Error("CSV needs a header row.");
  return result.data;
}

export function importWorkbook(data: ArrayBuffer, filename: string): ImportedWorkbook {
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder().decode(data);
    return { sheets: { Sheet1: parseCsv(text) }, names: ["Sheet1"] };
  }
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheets: Record<string, ApiRow[]> = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet) sheets[name] = XLSX.utils.sheet_to_json<ApiRow>(sheet, { defval: null, raw: false });
  }
  if (!workbook.SheetNames.length) throw new Error("The workbook has no sheets.");
  return { sheets, names: workbook.SheetNames };
}

function compare(left: unknown, right: unknown): number {
  const aNumber = Number(left);
  const bNumber = Number(right);
  if (left !== "" && right !== "" && Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }
  return displayValue(left).localeCompare(displayValue(right), undefined, { numeric: true, sensitivity: "base" });
}

function matches(row: ApiRow, key: string, expected: string): boolean {
  const operators = ["__contains", "__starts", "__ends", "__gt", "__gte", "__lt", "__lte"] as const;
  const operator = operators.find((suffix) => key.endsWith(suffix));
  const field = operator ? key.slice(0, -operator.length) : key;
  const actual = row[field];
  if (operator === "__contains") return displayValue(actual).toLowerCase().includes(expected.toLowerCase());
  if (operator === "__starts") return displayValue(actual).toLowerCase().startsWith(expected.toLowerCase());
  if (operator === "__ends") return displayValue(actual).toLowerCase().endsWith(expected.toLowerCase());
  if (operator === "__gt") return compare(actual, expected) > 0;
  if (operator === "__gte") return compare(actual, expected) >= 0;
  if (operator === "__lt") return compare(actual, expected) < 0;
  if (operator === "__lte") return compare(actual, expected) <= 0;
  return displayValue(actual).toLowerCase() === expected.toLowerCase();
}

export function runMockRequest(
  rows: ApiRow[],
  config: Pick<MockConfig, "route" | "idField">,
  input: string,
  method = "GET",
): MockResponse {
  const base = "https://mock.local";
  let url: URL;
  try {
    url = new URL(input.startsWith("/") ? input : `/${input}`, base);
  } catch {
    return response(400, { error: "Invalid request URL." });
  }
  if (method.toUpperCase() !== "GET") return response(405, { error: "Only GET requests are mocked." });

  const route = normalizeRoute(config.route);
  const path = normalizeRoute(url.pathname);
  if (path !== route && !path.startsWith(`${route}/`)) return response(404, { error: "Route not found." });

  const id = path === route ? "" : decodeURIComponent(path.slice(route.length + 1));
  if (id) {
    if (!config.idField) return response(400, { error: "Choose an ID field before requesting an item." });
    const item = rows.find((row) => displayValue(row[config.idField]) === id);
    return item ? response(200, item) : response(404, { error: "Item not found." });
  }

  const reserved = new Set(["_sort", "_order", "_page", "_limit"]);
  let result = rows.filter((row) =>
    [...url.searchParams].every(([key, value]) => reserved.has(key) || matches(row, key, value)),
  );
  const sortFields = (url.searchParams.get("_sort") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const orders = (url.searchParams.get("_order") ?? "").split(",").map((value) => value.trim().toLowerCase());
  if (sortFields.length) {
    result = [...result].sort((a, b) => {
      for (let index = 0; index < sortFields.length; index += 1) {
        const field = sortFields[index];
        if (!field) continue;
        const value = compare(a[field], b[field]);
        if (value) return orders[index] === "desc" ? -value : value;
      }
      return 0;
    });
  }

  const total = result.length;
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("_limit")) || 25));
  const page = Math.max(1, Number(url.searchParams.get("_page")) || 1);
  result = result.slice((page - 1) * limit, page * limit);
  return response(200, result, {
    "x-total-count": String(total),
    "x-page": String(page),
    "x-page-size": String(limit),
  });
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): MockResponse {
  return { status, body, headers: { "content-type": "application/json", ...headers } };
}

export function makeFetchExample(route: string): string {
  return `const response = await mockFetch("${normalizeRoute(route)}?_page=1&_limit=25");\nconst rows = await response.json();`;
}

export function makeOpenApi(config: MockConfig, rows: ApiRow[]): string {
  const route = normalizeRoute(config.route);
  const sample = rows[0] ?? {};
  const properties = Object.fromEntries(Object.entries(sample).map(([key, value]) => [
    key,
    { type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string" },
  ]));
  return JSON.stringify({
    openapi: "3.0.0-like",
    info: { title: "Local spreadsheet mock", version: "1.0.0" },
    paths: {
      [route]: { get: { parameters: ["filters", "_sort", "_order", "_page", "_limit"], responses: { "200": { description: "Collection" } } } },
      [`${route}/{id}`]: { get: { parameters: [{ name: "id", in: "path", required: true }], responses: { "200": { description: "Item" }, "404": { description: "Not found" } } } },
    },
    components: { schemas: { Row: { type: "object", properties } } },
  }, null, 2);
}

export function createMockFetch(rows: ApiRow[], config: Pick<MockConfig, "route" | "idField">): typeof fetch {
  return (input, init) => {
    const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const result = runMockRequest(rows, config, requestUrl, method);
    return Promise.resolve(new Response(JSON.stringify(result.body, null, 2), { status: result.status, headers: result.headers }));
  };
}
