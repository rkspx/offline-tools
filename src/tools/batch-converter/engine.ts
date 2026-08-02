import Papa from "papaparse";

export type ConversionKind =
  | "length"
  | "mass"
  | "temperature"
  | "volume"
  | "speed"
  | "data"
  | "timezone"
  | "currency";

export type UnitDefinition = {
  label: string;
  factor: number;
  offset?: number;
};

export type CurrencyRates = {
  base: string;
  date: string;
  rates: Record<string, number>;
};

export type TimezoneResult = {
  value: string;
  warning?: string;
};

export type RowResult = {
  row: Record<string, string>;
  error?: string;
  warning?: string;
};

export const UNITS: Record<Exclude<ConversionKind, "timezone" | "currency">, Record<string, UnitDefinition>> = {
  length: {
    mm: { label: "Millimeters", factor: 0.001 },
    cm: { label: "Centimeters", factor: 0.01 },
    m: { label: "Meters", factor: 1 },
    km: { label: "Kilometers", factor: 1000 },
    in: { label: "Inches", factor: 0.0254 },
    ft: { label: "Feet", factor: 0.3048 },
    yd: { label: "Yards", factor: 0.9144 },
    mi: { label: "Miles", factor: 1609.344 },
  },
  mass: {
    mg: { label: "Milligrams", factor: 0.000001 },
    g: { label: "Grams", factor: 0.001 },
    kg: { label: "Kilograms", factor: 1 },
    oz: { label: "Ounces", factor: 0.028349523125 },
    lb: { label: "Pounds", factor: 0.45359237 },
    t: { label: "Metric tonnes", factor: 1000 },
  },
  temperature: {
    C: { label: "Celsius", factor: 1, offset: 0 },
    F: { label: "Fahrenheit", factor: 5 / 9, offset: -32 },
    K: { label: "Kelvin", factor: 1, offset: -273.15 },
  },
  volume: {
    ml: { label: "Milliliters", factor: 0.001 },
    l: { label: "Liters", factor: 1 },
    "m3": { label: "Cubic meters", factor: 1000 },
    tsp: { label: "Teaspoons (US)", factor: 0.00492892159375 },
    tbsp: { label: "Tablespoons (US)", factor: 0.01478676478125 },
    cup: { label: "Cups (US)", factor: 0.2365882365 },
    floz: { label: "Fluid ounces (US)", factor: 0.0295735295625 },
    gal: { label: "Gallons (US)", factor: 3.785411784 },
  },
  speed: {
    "m/s": { label: "Meters per second", factor: 1 },
    "km/h": { label: "Kilometers per hour", factor: 1 / 3.6 },
    mph: { label: "Miles per hour", factor: 0.44704 },
    knot: { label: "Knots", factor: 0.514444444444 },
    "ft/s": { label: "Feet per second", factor: 0.3048 },
  },
  data: {
    B: { label: "Bytes", factor: 1 },
    KB: { label: "Kilobytes (10³)", factor: 1000 },
    MB: { label: "Megabytes (10⁶)", factor: 1_000_000 },
    GB: { label: "Gigabytes (10⁹)", factor: 1_000_000_000 },
    TB: { label: "Terabytes (10¹²)", factor: 1_000_000_000_000 },
    KiB: { label: "Kibibytes (2¹⁰)", factor: 1024 },
    MiB: { label: "Mebibytes (2²⁰)", factor: 1_048_576 },
    GiB: { label: "Gibibytes (2³⁰)", factor: 1_073_741_824 },
  },
};

// Offline reference snapshot. Rates are units of currency per 1 USD.
export const BUNDLED_RATES: CurrencyRates = {
  base: "USD",
  date: "2026-07-31",
  rates: {
    USD: 1,
    EUR: 0.922,
    GBP: 0.798,
    JPY: 149.74,
    CAD: 1.371,
    AUD: 1.526,
    CHF: 0.884,
    CNY: 7.214,
    INR: 83.72,
    NZD: 1.684,
    SGD: 1.342,
    KRW: 1384.2,
    MXN: 18.43,
    BRL: 5.61,
  },
};

export function parseCsv(text: string): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? "Could not parse CSV.");
  if (!parsed.meta.fields?.length) throw new Error("CSV needs a header row.");
  return parsed.data;
}

export function serializeCsv(rows: Record<string, string>[]): string {
  return Papa.unparse(rows, { newline: "\r\n" });
}

export function convertUnit(value: number, kind: Exclude<ConversionKind, "timezone" | "currency">, from: string, to: string): number {
  const source = UNITS[kind][from];
  const target = UNITS[kind][to];
  if (!source || !target) throw new Error(`Unknown ${kind} unit.`);
  const base = (value + (source.offset ?? 0)) * source.factor;
  return base / target.factor - (target.offset ?? 0);
}

export function convertCurrency(value: number, from: string, to: string, snapshot: CurrencyRates): number {
  const source = snapshot.rates[from];
  const target = snapshot.rates[to];
  if (!source || !target) throw new Error(`Missing exchange rate for ${!source ? from : to}.`);
  return (value / source) * target;
}

export function importCurrencyRates(text: string): CurrencyRates {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The rate file is empty.");
  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed) as Partial<CurrencyRates>;
    if (!data.base || !data.date || !data.rates || typeof data.rates !== "object") {
      throw new Error("JSON rates need base, date, and rates fields.");
    }
    return validateRates(data.base, data.date, data.rates);
  }
  const rows = Papa.parse<Record<string, string>>(trimmed, { header: true, skipEmptyLines: true });
  if (rows.errors.length) throw new Error(rows.errors[0]?.message ?? "Could not parse rate CSV.");
  const first = rows.data[0];
  if (!first) throw new Error("Rate CSV has no rows.");
  const base = first.base ?? "USD";
  const date = first.date ?? "";
  const rates: Record<string, number> = { [base]: 1 };
  for (const row of rows.data) {
    const currency = row.currency?.trim().toUpperCase();
    if (!currency) throw new Error("Every rate row needs a currency.");
    rates[currency] = Number(row.rate);
  }
  return validateRates(base, date, rates);
}

function validateRates(base: string, date: string, rates: Record<string, unknown>): CurrencyRates {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Rate date must use YYYY-MM-DD.");
  const normalized: Record<string, number> = {};
  for (const [currency, rawRate] of Object.entries(rates)) {
    const rate = Number(rawRate);
    if (!currency || !Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid rate for ${currency || "unnamed currency"}.`);
    normalized[currency.toUpperCase()] = rate;
  }
  const normalizedBase = base.toUpperCase();
  normalized[normalizedBase] = normalized[normalizedBase] ?? 1;
  return { base: normalizedBase, date, rates: normalized };
}

function dateParts(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

export function convertTimezone(value: string, fromZone: string, toZone: string): TimezoneResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error("Use YYYY-MM-DD HH:mm or YYYY-MM-DDTHH:mm:ss.");
  const targetLocal = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}`;
  const utcGuess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  const matches: Date[] = [];

  // Timezone offsets range from UTC-12 through UTC+14. Fifteen-minute steps
  // cover all offsets in the IANA database and identify DST folds and gaps.
  for (let delta = -14 * 60; delta <= 14 * 60; delta += 15) {
    const candidate = new Date(utcGuess + delta * 60_000);
    if (dateParts(candidate, fromZone) === targetLocal) matches.push(candidate);
  }
  if (!matches.length) {
    return { value: "", warning: `This local time does not exist in ${fromZone}, usually because clocks move forward.` };
  }
  const firstMatch = matches[0];
  if (!firstMatch) throw new Error("Could not resolve that local time.");
  const valueInTarget = dateParts(firstMatch, toZone).replace("T", " ");
  if (matches.length > 1) {
    return { value: valueInTarget, warning: `This local time occurs twice in ${fromZone}. The earlier occurrence was used.` };
  }
  return { value: valueInTarget };
}

export function convertRows(
  rows: Record<string, string>[],
  config: {
    sourceColumn: string;
    outputColumn: string;
    kind: ConversionKind;
    from: string;
    to: string;
    rates?: CurrencyRates;
    precision?: number;
  },
): RowResult[] {
  return rows.map((row) => {
    const next = { ...row };
    const raw = row[config.sourceColumn] ?? "";
    try {
      if (config.kind === "timezone") {
        const result = convertTimezone(raw, config.from, config.to);
        if (!result.value) return { row: next, error: result.warning ?? "Invalid local time." };
        next[config.outputColumn] = result.value;
        return result.warning ? { row: next, warning: result.warning } : { row: next };
      }
      const number = Number(raw);
      if (!raw.trim() || !Number.isFinite(number)) throw new Error(`"${raw}" is not a number.`);
      const converted = config.kind === "currency"
        ? convertCurrency(number, config.from, config.to, config.rates ?? BUNDLED_RATES)
        : convertUnit(number, config.kind, config.from, config.to);
      next[config.outputColumn] = Number(converted.toFixed(config.precision ?? 6)).toString();
      return { row: next };
    } catch (error) {
      return { row: next, error: error instanceof Error ? error.message : "Conversion failed." };
    }
  });
}
