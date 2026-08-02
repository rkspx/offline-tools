import {
  BracketsCurlyIcon,
  ChartBarIcon,
  DatabaseIcon,
  DownloadSimpleIcon,
  FileCsvIcon,
  PlayIcon,
  StopIcon,
  TableIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  chartPoints,
  resultToCsv,
  resultToHtml,
  type ChartKind,
  type QueryResult,
  type TableInfo,
} from "./engine";
import { DuckDbAnalyzer } from "./worker";
import "./styles.css";

const STARTER_SQL = "SELECT *\nFROM imported_data\nLIMIT 100;";

function saveFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatCell(value: QueryResult["rows"][number][number]) {
  if (value === null) return <span className="sqlite-null">NULL</span>;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function ResultChart({
  result,
  labelColumn,
  valueColumn,
  kind,
}: {
  readonly result: QueryResult;
  readonly labelColumn: string;
  readonly valueColumn: string;
  readonly kind: ChartKind;
}) {
  const points = chartPoints(result, labelColumn, valueColumn).slice(0, 20);
  if (!points.length) {
    return <div className="sqlite-chart-empty">Choose a text column and a numeric column to draw a chart.</div>;
  }
  const width = 760;
  const height = 280;
  const pad = { top: 18, right: 18, bottom: 58, left: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const min = Math.min(0, ...points.map((point) => point.value));
  const max = Math.max(0, ...points.map((point) => point.value));
  const range = max - min || 1;
  const y = (value: number) => pad.top + ((max - value) / range) * plotHeight;
  const zeroY = y(0);
  const slot = plotWidth / points.length;
  const polyline = points.map((point, index) => `${pad.left + slot * (index + 0.5)},${y(point.value)}`).join(" ");

  return (
    <svg className="sqlite-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${kind} chart of ${valueColumn} by ${labelColumn}`}>
      <line className="sqlite-chart-axis" x1={pad.left} x2={width - pad.right} y1={zeroY} y2={zeroY} />
      <text className="sqlite-chart-tick" x={pad.left - 8} y={pad.top + 4} textAnchor="end">{max.toLocaleString()}</text>
      <text className="sqlite-chart-tick" x={pad.left - 8} y={zeroY + 4} textAnchor="end">0</text>
      {kind === "bar" ? points.map((point, index) => {
        const pointY = y(point.value);
        return (
          <rect
            className="sqlite-chart-bar"
            key={`${point.label}-${index}`}
            x={pad.left + slot * index + slot * 0.16}
            y={Math.min(pointY, zeroY)}
            width={slot * 0.68}
            height={Math.max(1, Math.abs(zeroY - pointY))}
            rx={3}
          >
            <title>{point.label}: {point.value}</title>
          </rect>
        );
      }) : (
        <>
          <polyline className="sqlite-chart-line" points={polyline} />
          {points.map((point, index) => (
            <circle className="sqlite-chart-dot" key={`${point.label}-${index}`} cx={pad.left + slot * (index + 0.5)} cy={y(point.value)} r={4}>
              <title>{point.label}: {point.value}</title>
            </circle>
          ))}
        </>
      )}
      {points.map((point, index) => (
        <text
          className="sqlite-chart-label"
          key={`${point.label}-label-${index}`}
          x={pad.left + slot * (index + 0.5)}
          y={height - 42}
          textAnchor="end"
          transform={`rotate(-38 ${pad.left + slot * (index + 0.5)} ${height - 42})`}
        >
          {point.label.length > 14 ? `${point.label.slice(0, 13)}…` : point.label}
        </text>
      ))}
    </svg>
  );
}

export default function SqliteAnalyzer() {
  const analyzerRef = useRef<DuckDbAnalyzer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [sql, setSql] = useState(STARTER_SQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Starting local DuckDB engine");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState<"initializing" | "importing" | "querying" | null>("initializing");
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<"table" | "chart">("table");
  const [chartKind, setChartKind] = useState<ChartKind>("bar");
  const [labelColumn, setLabelColumn] = useState("");
  const [valueColumn, setValueColumn] = useState("");

  useEffect(() => {
    const analyzer = new DuckDbAnalyzer();
    analyzerRef.current = analyzer;
    void analyzer.initialize().then(() => {
      setBusy(null);
      setStatus("Ready. Files stay in this browser tab.");
    }).catch((reason: unknown) => {
      setBusy(null);
      setError(reason instanceof Error ? reason.message : "DuckDB could not start.");
      setStatus("Engine unavailable");
    });
    return () => {
      abortRef.current?.abort();
      void analyzer.close();
    };
  }, []);

  const numericColumns = useMemo(() => {
    if (!result) return [];
    return result.columns.filter((_, index) => result.rows.some((row) => {
      const value = row[index];
      return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
    }));
  }, [result]);
  const selectedLabelColumn = result?.columns.includes(labelColumn) ? labelColumn : result?.columns[0] ?? "";
  const selectedValueColumn = numericColumns.includes(valueColumn) ? valueColumn : numericColumns[0] ?? "";

  const importFile = async (file: File) => {
    if (!analyzerRef.current || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("importing");
    setProgress(0);
    setError("");
    setStatus(`Reading ${file.name}`);
    setResult(null);
    try {
      const imported = await analyzerRef.current.importFile(file, setProgress, controller.signal);
      setTables(imported.tables);
      setSourceName(file.name);
      const nextSql = `SELECT *\nFROM ${quoteIdentifier(imported.tableName)}\nLIMIT 100;`;
      setSql(nextSql);
      setStatus(`${file.name} imported as ${imported.tableName}`);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setStatus("Import cancelled");
      } else {
        setError(reason instanceof Error ? reason.message : "The file could not be imported.");
        setStatus("Import failed");
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
      setProgress(0);
    }
  };

  const runQuery = async () => {
    if (!analyzerRef.current || busy) return;
    setBusy("querying");
    setError("");
    setStatus("Running query in DuckDB worker");
    const started = performance.now();
    try {
      const next = await analyzerRef.current.query(sql);
      setResult(next);
      setStatus(`${next.rows.length.toLocaleString()} rows in ${next.elapsedMs.toLocaleString()} ms`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The query failed.";
      setError(message.includes("cancel") ? "Query cancelled." : message);
      setStatus(message.includes("cancel") ? "Query cancelled" : `Query failed after ${Math.round(performance.now() - started)} ms`);
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (busy === "querying") void analyzerRef.current?.cancelQuery();
    setStatus(busy === "importing" ? "Cancelling import" : "Cancelling query");
  };

  return (
    <div className="sqlite-analyzer">
      <header className="sqlite-header">
        <div>
          <div className="sqlite-title"><DatabaseIcon aria-hidden size={24} weight="duotone" /><h2>Local Data Analyzer</h2></div>
          <Text as="p" size="2">Query CSV and JSON with DuckDB. No file contents leave this tab.</Text>
        </div>
        <div className="sqlite-engine-status" aria-live="polite">
          <span className={busy ? "is-busy" : ""} />
          <div><strong>{busy ? "Working" : "Local engine"}</strong><small>{status}</small></div>
        </div>
      </header>

      {error ? <Callout.Root color="red" role="alert"><Callout.Text>{error}</Callout.Text></Callout.Root> : null}

      <div className="sqlite-workspace">
        <aside className="sqlite-sidebar">
          <label
            className={`sqlite-dropzone ${dragging ? "is-dragging" : ""} ${busy ? "is-disabled" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void importFile(file);
            }}
          >
            <UploadSimpleIcon aria-hidden size={23} />
            <strong>Import a data file</strong>
            <span>CSV, JSON, JSONL, NDJSON</span>
            <input
              type="file"
              accept=".csv,.json,.jsonl,.ndjson,.sqlite,.sqlite3,.db"
              disabled={Boolean(busy)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {busy === "importing" ? (
            <div className="sqlite-progress">
              <div><span>Importing</span><strong>{progress}%</strong></div>
              <progress max={100} value={progress}>{progress}%</progress>
            </div>
          ) : null}

          <div className="sqlite-supported">
            <span><FileCsvIcon aria-hidden /> CSV</span>
            <span><BracketsCurlyIcon aria-hidden /> JSON</span>
          </div>

          <div className="sqlite-schema-heading">
            <strong>Schema</strong>
            <span>{tables.length} {tables.length === 1 ? "table" : "tables"}</span>
          </div>
          <div className="sqlite-schema">
            {tables.map((table) => (
              <details key={table.name} open>
                <summary>
                  <TableIcon aria-hidden />
                  <span>{table.name}</span>
                  <small>{table.rowCount.toLocaleString()} rows</small>
                </summary>
                <button type="button" onClick={() => setSql(`SELECT *\nFROM ${quoteIdentifier(table.name)}\nLIMIT 100;`)}>Use in query</button>
                <dl>
                  {table.columns.map((column) => (
                    <div key={column.name}>
                      <dt title={column.name}>{column.name}</dt>
                      <dd>{column.type}{column.nullable ? "" : " not null"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
            {!tables.length ? <div className="sqlite-schema-empty">Import a file to inspect its inferred columns and types.</div> : null}
          </div>
          <p className="sqlite-limitation">SQLite note: DuckDB-Wasm does not bundle the sqlite_scanner extension. This build does not claim browser SQLite support.</p>
        </aside>

        <main className="sqlite-main">
          <section className="sqlite-editor-panel">
            <div className="sqlite-panel-head">
              <div><strong>SQL editor</strong><span>Read-only · Cmd/Ctrl + Enter to run</span></div>
              {busy === "querying" || busy === "importing" ? (
                <Button color="red" variant="soft" onClick={cancel}><StopIcon aria-hidden /> Cancel</Button>
              ) : (
                <Button disabled={busy === "initializing"} onClick={() => void runQuery()}><PlayIcon aria-hidden weight="fill" /> Run query</Button>
              )}
            </div>
            <textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void runQuery();
                }
              }}
              spellCheck={false}
              aria-label="SQL query"
            />
            <div className="sqlite-safety">Read-only statements only. External URLs, extension loading, file reads, and mutations are blocked.</div>
          </section>

          <section className="sqlite-results-panel">
            <div className="sqlite-panel-head sqlite-results-head">
              <div className="sqlite-view-tabs">
                <button className={view === "table" ? "is-active" : ""} onClick={() => setView("table")}><TableIcon aria-hidden /> Results</button>
                <button className={view === "chart" ? "is-active" : ""} onClick={() => setView("chart")} disabled={!result}><ChartBarIcon aria-hidden /> Chart</button>
              </div>
              <div className="sqlite-export-actions">
                <span>{result ? `${result.rows.length.toLocaleString()} rows · ${result.elapsedMs} ms${result.truncated ? " · limited to 10,000" : ""}` : "No results"}</span>
                <Button size="1" variant="soft" disabled={!result} onClick={() => result && saveFile(resultToCsv(result), "query-result.csv", "text/csv;charset=utf-8")}><DownloadSimpleIcon aria-hidden /> CSV</Button>
                <Button size="1" variant="soft" disabled={!result} onClick={() => result && saveFile(resultToHtml(result, sql, sourceName || "Local data"), "query-report.html", "text/html;charset=utf-8")}><DownloadSimpleIcon aria-hidden /> HTML</Button>
              </div>
            </div>

            {!result ? (
              <div className="sqlite-empty-result">
                <DatabaseIcon aria-hidden size={34} weight="duotone" />
                <strong>Your query results will appear here</strong>
                <span>Import local data, inspect its schema, then run a read-only query.</span>
              </div>
            ) : view === "table" ? (
              <div className="sqlite-table-wrap">
                <table>
                  <thead><tr><th>#</th>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <td>{rowIndex + 1}</td>
                      {row.map((cell, columnIndex) => <td key={`${rowIndex}-${result.columns[columnIndex] ?? columnIndex}`}>{formatCell(cell)}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="sqlite-chart-builder">
                <div className="sqlite-chart-controls">
                  <label>Chart type<select value={chartKind} onChange={(event) => setChartKind(event.target.value as ChartKind)}><option value="bar">Bar</option><option value="line">Line</option></select></label>
                  <label>Labels<select value={selectedLabelColumn} onChange={(event) => setLabelColumn(event.target.value)}>{result.columns.map((column) => <option key={column}>{column}</option>)}</select></label>
                  <label>Values<select value={selectedValueColumn} onChange={(event) => setValueColumn(event.target.value)}><option value="">Choose numeric column</option>{numericColumns.map((column) => <option key={column}>{column}</option>)}</select></label>
                </div>
                <div className="sqlite-chart-wrap"><ResultChart result={result} labelColumn={selectedLabelColumn} valueColumn={selectedValueColumn} kind={chartKind} /></div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
