import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadText } from "../../lib/downloads";
import {
  inferFindings,
  parseCsv,
  scrubRows,
  serializeCsv,
  type ColumnAction,
} from "./engine";
import "./styles.css";

const SAMPLE = `customer_id,name,email,phone,birth_date,city
1001,Ana Silva,ana@example.com,+1 212 555 0141,1988-04-12,Boston
1002,Dev Kumar,dev.kumar@example.org,+44 20 7946 0958,1993-11-02,London
1003,Mia Chen,mia@sample.net,+65 6123 4567,1979-07-27,Singapore`;

const ACTIONS: { value: ColumnAction; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "redact", label: "Redact" },
  { value: "hash", label: "Hash (SHA-256)" },
  { value: "tokenize", label: "Tokenize" },
  { value: "generalize", label: "Generalize" },
];

export default function PiiScrubber() {
  const [source, setSource] = useState(SAMPLE);
  const [actions, setActions] = useState<Record<string, ColumnAction>>({});
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [processingError, setProcessingError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tokenMap = useRef(new Map<string, string>());
  const salt = useRef("");

  const parsed = useMemo(() => {
    try {
      const data = parseCsv(source);
      return { data, findings: inferFindings(data), error: "" };
    } catch (error) {
      return {
        data: null,
        findings: [],
        error: error instanceof Error ? error.message : "Could not parse CSV.",
      };
    }
  }, [source]);

  const effectiveActions = useMemo(() => Object.fromEntries(
    parsed.findings.map((finding) => [finding.column, actions[finding.column] ?? finding.suggestedAction]),
  ) as Record<string, ColumnAction>, [actions, parsed.findings]);

  useEffect(() => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    salt.current = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!parsed.data) return;
    void scrubRows(parsed.data, effectiveActions, parsed.findings, { salt: salt.current, tokenMap: tokenMap.current })
      .then((rows) => {
        if (!cancelled) {
          setPreview(rows);
          setProcessingError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setProcessingError(error instanceof Error ? error.message : "Scrubbing failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveActions, parsed.data, parsed.findings]);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setProcessingError("Choose a CSV file.");
      return;
    }
    setSource(await file.text());
    tokenMap.current.clear();
  };

  const exportCsv = async () => {
    if (!parsed.data) return;
    setBusy(true);
    try {
      const rows = await scrubRows(parsed.data, effectiveActions, parsed.findings, {
        salt: salt.current,
        tokenMap: tokenMap.current,
      });
      downloadText(serializeCsv(rows, parsed.data.columns), "scrubbed.csv", "text/csv;charset=utf-8");
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const changedColumns = Object.values(effectiveActions).filter((action) => action !== "keep").length;
  const visiblePreview = parsed.data ? preview : [];
  const warningMessage = processingError !== "" ? processingError : parsed.data?.warnings.join(" ") ?? "";

  return (
    <div className="pii-app">
      <section className="pii-source">
        <header>
          <div>
            <strong>Source CSV</strong>
            <span>Paste data or open a CSV with a header row.</span>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()}>
            <FileArrowUpIcon aria-hidden size={17} /> Open CSV
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void loadFile(event.currentTarget.files?.[0])}
          />
        </header>
        <textarea aria-label="CSV data" spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} />
        <footer>
          <span className={parsed.error ? "is-error" : ""}>
            {parsed.error || `${parsed.data?.rows.length ?? 0} rows · ${parsed.data?.columns.length ?? 0} columns`}
          </span>
          <span>Data never leaves this browser</span>
        </footer>
      </section>

      <section className="pii-findings">
        <header>
          <div>
            <strong>Column policy</strong>
            <span>Suggestions use column names and sampled value patterns. Review every choice.</span>
          </div>
          <span className="pii-count">{changedColumns} columns transformed</span>
        </header>
        {!parsed.data ? <div className="pii-empty">Enter valid CSV data to inspect columns.</div> : (
          <div className="pii-policy-list">
            {parsed.findings.map((finding) => (
              <div className="pii-policy" key={finding.column}>
                <div className="pii-column">
                  <strong>{finding.column}</strong>
                  <span>{finding.kinds.length ? finding.kinds.join(", ") : "No pattern detected"}</span>
                </div>
                <div className="pii-samples" title={finding.samples.join("\n")}>
                  {finding.matches ? `${finding.matches} likely matches` : "No likely matches"}
                </div>
                <label>
                  <span className="visually-hidden">Action for {finding.column}</span>
                  <select
                    value={effectiveActions[finding.column] ?? finding.suggestedAction}
                    onChange={(event) => setActions((current) => ({
                      ...current,
                      [finding.column]: event.target.value as ColumnAction,
                    }))}
                  >
                    {ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                  </select>
                </label>
              </div>
            ))}
          </div>
        )}
      </section>

      {warningMessage !== "" && (
        <div className="pii-warning" role="alert">
          <WarningCircleIcon aria-hidden size={18} />
          <span>{warningMessage}</span>
        </div>
      )}

      <section className="pii-preview">
        <header>
          <div>
            <strong>Scrubbed preview</strong>
            <span>First 20 rows · full dataset is included in export.</span>
          </div>
          <span className="pii-ready"><ShieldCheckIcon aria-hidden size={17} /> {busy ? "Processing…" : "Preview ready"}</span>
        </header>
        {!visiblePreview.length ? <div className="pii-empty">{parsed.error || "No rows to preview."}</div> : (
          <div className="pii-table-wrap">
            <table>
              <thead><tr>{parsed.data?.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {visiblePreview.slice(0, 20).map((row, index) => (
                  <tr key={index}>
                    {parsed.data?.columns.map((column) => (
                      <td className={effectiveActions[column] !== "keep" ? "is-changed" : ""} key={column}>{row[column]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer>
          <span>Hashes include a random session salt. Tokens stay stable for this session and dataset.</span>
          <button className="pii-primary" type="button" disabled={!parsed.data || busy} onClick={() => void exportCsv()}>
            <DownloadSimpleIcon aria-hidden size={18} /> Export CSV
          </button>
        </footer>
      </section>
    </div>
  );
}
