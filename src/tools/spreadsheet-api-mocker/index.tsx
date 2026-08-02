import {
  ArrowClockwiseIcon,
  ClipboardIcon,
  FileArrowUpIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createMockFetch,
  displayValue,
  importWorkbook,
  makeFetchExample,
  makeOpenApi,
  normalizeRoute,
  runMockRequest,
  type ApiRow,
  type MockConfig,
} from "./engine";
import "./styles.css";

const STORAGE_KEY = "minitools:spreadsheet-api-mocker:config";
const SAMPLE_ROWS: ApiRow[] = [
  { id: 101, sku: "MUG-RD", name: "Red studio mug", price: 18, active: true },
  { id: 102, sku: "BOWL-BL", name: "Blue breakfast bowl", price: 24, active: true },
  { id: 103, sku: "VASE-SM", name: "Small stem vase", price: 31, active: false },
];

function storedConfig(): MockConfig {
  const fallback = { route: "/api/products", idField: "id", sheetName: "Products" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<MockConfig> };
  } catch {
    return fallback;
  }
}

export default function SpreadsheetApiMocker() {
  const [sheets, setSheets] = useState<Record<string, ApiRow[]>>({ Products: SAMPLE_ROWS });
  const [config, setConfig] = useState<MockConfig>(storedConfig);
  const [requestPath, setRequestPath] = useState("/api/products?_sort=price&_order=desc&_page=1&_limit=2");
  const [result, setResult] = useState(() => runMockRequest(SAMPLE_ROWS, config, requestPath));
  const [fileName, setFileName] = useState("Sample catalog");
  const [message, setMessage] = useState("Sample data is ready. Import a CSV or XLSX file to replace it.");
  const [outputKind, setOutputKind] = useState<"fetch" | "openapi">("fetch");
  const fileInput = useRef<HTMLInputElement>(null);

  const sheetNames = useMemo(() => Object.keys(sheets), [sheets]);
  const activeSheetName = sheetNames.includes(config.sheetName) ? config.sheetName : sheetNames[0] ?? "";
  const rows = useMemo(() => sheets[activeSheetName] ?? [], [activeSheetName, sheets]);
  const columns = Object.keys(rows[0] ?? {});
  const output = outputKind === "fetch" ? makeFetchExample(config.route) : makeOpenApi(config, rows);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch { /* Storage can be disabled without affecting the active mock. */ }
  }, [config]);

  const preview = useMemo(() => rows.slice(0, 8), [rows]);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = importWorkbook(await file.arrayBuffer(), file.name);
      const firstSheet = imported.names[0] ?? "";
      const firstRows = imported.sheets[firstSheet] ?? [];
      setSheets(imported.sheets);
      setFileName(file.name);
      setConfig((current) => ({
        ...current,
        sheetName: firstSheet,
        idField: Object.keys(firstRows[0] ?? {})[0] ?? "",
      }));
      setMessage(`${imported.names.length} sheet${imported.names.length === 1 ? "" : "s"} and ${firstRows.length} rows loaded locally.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read that spreadsheet.");
    }
  }

  function sendRequest() {
    setResult(runMockRequest(rows, config, requestPath));
  }

  async function sendThroughAdapter() {
    const mockFetch = createMockFetch(rows, config);
    const response = await mockFetch(requestPath);
    setResult({
      status: response.status,
      body: await response.json() as unknown,
      headers: Object.fromEntries(response.headers.entries()),
    });
  }

  return (
    <div className="sam-app">
      <section className="sam-topbar">
        <div>
          <strong>{fileName}</strong>
          <span>{message}</span>
        </div>
        <button type="button" onClick={() => fileInput.current?.click()}>
          <FileArrowUpIcon aria-hidden size={17} /> Import spreadsheet
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            void loadFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>

      <div className="sam-grid">
        <aside className="sam-config">
          <header><strong>Mock configuration</strong><span>Saved in local storage</span></header>
          <label>
            Sheet
            <select value={activeSheetName} onChange={(event) => setConfig({ ...config, sheetName: event.target.value })}>
              {sheetNames.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Collection route
            <input value={config.route} onBlur={() => setConfig({ ...config, route: normalizeRoute(config.route) })} onChange={(event) => setConfig({ ...config, route: event.target.value })} />
          </label>
          <label>
            ID field
            <select value={config.idField} onChange={(event) => setConfig({ ...config, idField: event.target.value })}>
              <option value="">No item route</option>
              {columns.map((column) => <option key={column}>{column}</option>)}
            </select>
          </label>
          <div className="sam-scope-note">
            <strong>Interception scope</strong>
            <p>This tool uses an in-page <code>mockFetch</code> adapter. A static host cannot safely grant a tool-level service worker scope from a root-served public file, and the app already owns the root PWA worker.</p>
          </div>
          <div className="sam-query-help">
            <strong>Query syntax</strong>
            <code>?status=active</code>
            <code>?name__contains=mug</code>
            <code>?price__gte=10</code>
            <code>?_sort=price&amp;_order=desc</code>
            <code>?_page=2&amp;_limit=25</code>
          </div>
        </aside>

        <main className="sam-main">
          <section className="sam-console">
            <header>
              <div><strong>Request console</strong><span>GET requests only</span></div>
              <span className={`sam-status status-${result.status < 400 ? "ok" : "error"}`}>{result.status}</span>
            </header>
            <div className="sam-request">
              <span>GET</span>
              <input aria-label="Request path" value={requestPath} onChange={(event) => setRequestPath(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendRequest()} />
              <button type="button" onClick={() => void sendThroughAdapter()}><LightningIcon aria-hidden size={16} /> Send</button>
            </div>
            <div className="sam-response-meta">
              {Object.entries(result.headers).map(([key, value]) => <span key={key}>{key}: {value}</span>)}
            </div>
            <pre aria-label="Mock response">{JSON.stringify(result.body, null, 2)}</pre>
          </section>

          <section className="sam-data">
            <header><div><strong>Source rows</strong><span>{rows.length} rows, {columns.length} columns</span></div><button type="button" onClick={sendRequest}><ArrowClockwiseIcon aria-hidden size={16} /> Refresh</button></header>
            {preview.length ? (
              <div className="sam-table-wrap">
                <table>
                  <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{preview.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : <div className="sam-empty">This sheet has no data rows.</div>}
          </section>

          <section className="sam-output">
            <header>
              <div className="sam-tabs">
                <button className={outputKind === "fetch" ? "active" : ""} type="button" onClick={() => setOutputKind("fetch")}>Fetch example</button>
                <button className={outputKind === "openapi" ? "active" : ""} type="button" onClick={() => setOutputKind("openapi")}>OpenAPI-like JSON</button>
              </div>
              <button type="button" onClick={() => void navigator.clipboard.writeText(output)}><ClipboardIcon aria-hidden size={16} /> Copy</button>
            </header>
            <textarea readOnly value={output} aria-label="Generated integration output" />
          </section>
        </main>
      </div>
    </div>
  );
}
