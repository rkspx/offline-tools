import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import {
  BUNDLED_RATES,
  UNITS,
  convertRows,
  importCurrencyRates,
  parseCsv,
  serializeCsv,
  type ConversionKind,
  type CurrencyRates,
} from "./engine";
import "./styles.css";

const SAMPLE = `route,distance_km,temperature_c,departure_local,price_usd
North loop,12.5,18,2026-03-08 01:30,24.50
Harbor express,8.2,21,2026-03-08 02:30,19.00
Airport link,not set,17,2026-11-01 01:30,31.75`;

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const KIND_LABELS: Record<ConversionKind, string> = {
  length: "Length",
  mass: "Mass",
  temperature: "Temperature",
  volume: "Volume",
  speed: "Speed",
  data: "Data size",
  timezone: "Timezone",
  currency: "Currency",
};

type Mapping = {
  id: number;
  source: string;
  output: string;
  kind: ConversionKind;
  from: string;
  to: string;
};

function defaults(kind: ConversionKind, currencies: string[]): [string, string] {
  if (kind === "timezone") return ["America/New_York", "UTC"];
  if (kind === "currency") return [currencies[0] ?? "USD", currencies[1] ?? "EUR"];
  const keys = Object.keys(UNITS[kind]);
  return [keys[0] ?? "", keys[1] ?? keys[0] ?? ""];
}

function optionsFor(kind: ConversionKind, currencies: string[]) {
  if (kind === "timezone") return TIMEZONES.map((value) => ({ value, label: value }));
  if (kind === "currency") return currencies.map((value) => ({ value, label: value }));
  return Object.entries(UNITS[kind]).map(([value, unit]) => ({ value, label: `${value} - ${unit.label}` }));
}

export default function BatchConverter() {
  const [csv, setCsv] = useState(SAMPLE);
  const [rates, setRates] = useState<CurrencyRates>(BUNDLED_RATES);
  const [rateMessage, setRateMessage] = useState("");
  const [mappings, setMappings] = useState<Mapping[]>([
    { id: 1, source: "distance_km", output: "distance_mi", kind: "length", from: "km", to: "mi" },
  ]);
  const [nextId, setNextId] = useState(2);
  const csvFile = useRef<HTMLInputElement>(null);
  const rateFile = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    try {
      const rows = parseCsv(csv);
      return { rows, columns: Object.keys(rows[0] ?? {}), error: "" };
    } catch (error) {
      return {
        rows: [] as Record<string, string>[],
        columns: [] as string[],
        error: error instanceof Error ? error.message : "Could not read CSV.",
      };
    }
  }, [csv]);

  const converted = useMemo(() => {
    let rows = parsed.rows.map((row) => ({ row, errors: [] as string[], warnings: [] as string[] }));
    for (const mapping of mappings) {
      const pass = convertRows(
        rows.map((item) => item.row),
        {
          sourceColumn: mapping.source,
          outputColumn: mapping.output || `${mapping.source}_${mapping.to.replaceAll("/", "_")}`,
          kind: mapping.kind,
          from: mapping.from,
          to: mapping.to,
          rates,
        },
      );
      rows = rows.map((item, index) => {
        const result = pass[index];
        if (!result) return item;
        return {
          row: result.row,
          errors: result.error ? [...item.errors, `${mapping.source}: ${result.error}`] : item.errors,
          warnings: result.warning ? [...item.warnings, `${mapping.source}: ${result.warning}`] : item.warnings,
        };
      });
    }
    return rows;
  }, [mappings, parsed.rows, rates]);

  const currencies = useMemo(() => Object.keys(rates.rates).sort(), [rates]);
  const errorCount = converted.filter((row) => row.errors.length).length;
  const warningCount = converted.filter((row) => row.warnings.length).length;
  const outputColumns = Object.keys(converted[0]?.row ?? {});

  const updateMapping = (id: number, patch: Partial<Mapping>) => {
    setMappings((current) => current.map((mapping) => mapping.id === id ? { ...mapping, ...patch } : mapping));
  };

  const changeKind = (mapping: Mapping, kind: ConversionKind) => {
    const [from, to] = defaults(kind, currencies);
    updateMapping(mapping.id, { kind, from, to });
  };

  const addMapping = () => {
    const source = parsed.columns[0] ?? "";
    setMappings((current) => [...current, { id: nextId, source, output: `${source}_converted`, kind: "length", from: "m", to: "km" }]);
    setNextId((value) => value + 1);
  };

  const loadCsv = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };

  const loadRates = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = importCurrencyRates(await file.text());
      setRates(imported);
      setRateMessage(`Using imported ${imported.base} snapshot dated ${imported.date}.`);
    } catch (error) {
      setRateMessage(error instanceof Error ? error.message : "Could not import rates.");
    }
  };

  const exportRows = () => {
    const rows = converted.map((item) => {
      const output = { ...item.row };
      if (item.errors.length) output._conversion_errors = item.errors.join(" | ");
      if (item.warnings.length) output._conversion_warnings = item.warnings.join(" | ");
      return output;
    });
    const blob = new Blob([serializeCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "converted.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bc-app">
      <section className="bc-source">
        <header>
          <div>
            <strong>Source CSV</strong>
            <span>First row must contain column names.</span>
          </div>
          <button type="button" onClick={() => csvFile.current?.click()}>
            <FileArrowUpIcon aria-hidden size={17} /> Open CSV
          </button>
          <input
            ref={csvFile}
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void loadCsv(event.target.files?.[0])}
          />
        </header>
        <textarea aria-label="CSV data" spellCheck={false} value={csv} onChange={(event) => setCsv(event.target.value)} />
        <footer>
          {parsed.error ? <span className="bc-error" role="alert">{parsed.error}</span> : (
            <span>{parsed.rows.length} rows, {parsed.columns.length} columns</span>
          )}
          <span>Processed only in this browser</span>
        </footer>
      </section>

      <section className="bc-mappings" aria-label="Column conversions">
        <header>
          <div>
            <strong>Conversion map</strong>
            <span>Build several output columns in one pass.</span>
          </div>
          <button type="button" onClick={addMapping} disabled={!parsed.columns.length}>
            <PlusIcon aria-hidden size={16} /> Add mapping
          </button>
        </header>
        {mappings.length === 0 ? (
          <div className="bc-empty">Add a mapping to choose a source column and conversion.</div>
        ) : mappings.map((mapping) => {
          const options = optionsFor(mapping.kind, currencies);
          return (
            <div className="bc-map" key={mapping.id}>
              <label>
                Source column
                <select value={mapping.source} onChange={(event) => updateMapping(mapping.id, { source: event.target.value })}>
                  {parsed.columns.map((column) => <option key={column}>{column}</option>)}
                </select>
              </label>
              <label>
                Conversion
                <select value={mapping.kind} onChange={(event) => changeKind(mapping, event.target.value as ConversionKind)}>
                  {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                From
                <select value={mapping.from} onChange={(event) => updateMapping(mapping.id, { from: event.target.value })}>
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                To
                <select value={mapping.to} onChange={(event) => updateMapping(mapping.id, { to: event.target.value })}>
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                Output column
                <input value={mapping.output} onChange={(event) => updateMapping(mapping.id, { output: event.target.value })} />
              </label>
              <button className="bc-remove" type="button" aria-label="Remove mapping" onClick={() => setMappings((current) => current.filter((item) => item.id !== mapping.id))}>
                <TrashIcon aria-hidden size={17} />
              </button>
            </div>
          );
        })}
      </section>

      <section className="bc-rates">
        <div>
          <strong>Currency rates</strong>
          <span>{rateMessage || `Bundled ${rates.base} reference snapshot dated ${rates.date}. Offline rates can become stale.`}</span>
        </div>
        <button type="button" onClick={() => rateFile.current?.click()}>Import rate file</button>
        <input
          ref={rateFile}
          className="visually-hidden"
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={(event) => void loadRates(event.target.files?.[0])}
        />
      </section>

      <section className="bc-preview">
        <header>
          <div>
            <strong>Preview</strong>
            <span>Showing the first 25 rows.</span>
          </div>
          <div className="bc-status">
            {errorCount > 0 && <span className="is-error"><WarningCircleIcon aria-hidden size={15} /> {errorCount} row errors</span>}
            {warningCount > 0 && <span className="is-warning"><WarningCircleIcon aria-hidden size={15} /> {warningCount} DST warnings</span>}
            {!errorCount && !warningCount && converted.length > 0 && <span className="is-ok">All rows converted</span>}
          </div>
        </header>
        {parsed.error || !converted.length ? (
          <div className="bc-empty">{parsed.error || "Paste a CSV with at least one data row."}</div>
        ) : (
          <div className="bc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {outputColumns.map((column) => <th key={column}>{column}</th>)}
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {converted.slice(0, 25).map((item, index) => (
                  <tr key={index} className={item.errors.length ? "has-error" : item.warnings.length ? "has-warning" : ""}>
                    <td>{index + 1}</td>
                    {outputColumns.map((column) => <td key={column}>{item.row[column]}</td>)}
                    <td className="bc-result-cell">
                      {item.errors.length ? item.errors.join(" | ") : item.warnings.length ? item.warnings.join(" | ") : "Ready"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer>
          <span>Rows with errors are preserved and annotated in the export.</span>
          <button type="button" className="bc-primary" disabled={!converted.length} onClick={exportRows}>
            <DownloadSimpleIcon aria-hidden size={18} /> Export CSV
          </button>
        </footer>
      </section>
    </div>
  );
}
