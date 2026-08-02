import {
  CheckSquareIcon,
  DownloadSimpleIcon,
  FileCsvIcon,
  FilePdfIcon,
  ShieldCheckIcon,
  SquareIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { downloadBlob, downloadText } from "../../lib/downloads";
import {
  MAX_FINANCIAL_FILE_BYTES,
  anonymizeCsv,
  findCsvValues,
  inspectPdf,
  parseFinancialCsv,
  permanentlyRedactPdf,
  tokenFor,
  type CsvDocument,
  type Finding,
} from "./engine";
import "./styles.css";

function mask(value: string): string {
  if (value.length < 5) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.min(10, value.length - 4))}${value.slice(-2)}`;
}

export default function FinancialAnonymizer() {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"csv" | "pdf" | null>(null);
  const [filename, setFilename] = useState("");
  const [csv, setCsv] = useState<CsvDocument | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"redact" | "tokenize">("redact");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const selectedFindings = useMemo(() => findings.filter((finding) => selected.has(finding.id)), [findings, selected]);
  const csvPreview = useMemo(
    () => csv ? anonymizeCsv(csv, findings, selected, mode).split(/\r?\n/).slice(0, 9).join("\n") : "",
    [csv, findings, mode, selected],
  );

  async function open(file?: File) {
    if (!file) return;
    setError("");
    setStatus("Inspecting locally…");
    if (file.size > MAX_FINANCIAL_FILE_BYTES) {
      setError("File exceeds the 25 MB limit.");
      setStatus("");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    try {
      let nextFindings: Finding[];
      if (extension === "csv") {
        const document = parseFinancialCsv(await file.text());
        nextFindings = findCsvValues(document);
        setCsv(document);
        setPdfBytes(null);
        setKind("csv");
      } else if (extension === "pdf") {
        const bytes = await file.arrayBuffer();
        const inspected = await inspectPdf(bytes.slice(0));
        nextFindings = inspected.findings;
        setPdfBytes(bytes);
        setCsv(null);
        setKind("pdf");
      } else {
        throw new Error("Choose a CSV or PDF file.");
      }
      setFilename(file.name);
      setFindings(nextFindings);
      setSelected(new Set(nextFindings.map((finding) => finding.id)));
      setStatus("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not inspect this file.");
      setStatus("");
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function exportResult() {
    setError("");
    if (kind === "csv" && csv) {
      downloadText(anonymizeCsv(csv, findings, selected, mode), `anonymized-${filename}`, "text/csv;charset=utf-8");
      return;
    }
    if (kind === "pdf" && pdfBytes) {
      setStatus("Flattening PDF pages…");
      try {
        const bytes = await permanentlyRedactPdf(pdfBytes.slice(0), findings, selected, mode, (page, total) =>
          setStatus(`Flattening page ${page} of ${total}…`),
        );
        downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `redacted-${filename}`);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not build the redacted PDF.");
      } finally {
        setStatus("");
      }
    }
  }

  return (
    <div className="fa-app">
      <section className="fa-intro">
        <ShieldCheckIcon size={24} weight="duotone" aria-hidden />
        <div><strong>Local-only anonymization</strong><span>Files are processed in this browser and are not uploaded.</span></div>
        <button type="button" disabled={Boolean(status)} onClick={() => input.current?.click()}>
          {kind === "pdf" ? <FilePdfIcon size={18} aria-hidden /> : <FileCsvIcon size={18} aria-hidden />}
          {filename ? "Replace file" : "Choose CSV or PDF"}
        </button>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          onChange={(event) => {
            void open(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </section>

      {error && <div className="fa-error" role="alert">{error}</div>}
      {status && <div className="fa-status" role="status">{status}</div>}

      {!kind ? (
        <section className="fa-empty">
          <div><FileCsvIcon size={30} aria-hidden /><FilePdfIcon size={30} aria-hidden /></div>
          <strong>Inspect a financial document</strong>
          <span>Detect emails, phones, government IDs, payment cards, IBANs, routing numbers, and account identifiers. Maximum 25 MB.</span>
        </section>
      ) : (
        <>
          <section className="fa-toolbar">
            <div><strong>{findings.length}</strong><span>findings in {filename}</span></div>
            <button type="button" onClick={() => setSelected(new Set(findings.map((finding) => finding.id)))}>Select all</button>
            <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
            <div className="fa-modes" aria-label="Anonymization mode">
              <button className={mode === "redact" ? "is-active" : ""} type="button" onClick={() => setMode("redact")}>Redact</button>
              <button className={mode === "tokenize" ? "is-active" : ""} type="button" onClick={() => setMode("tokenize")}>Tokenize</button>
            </div>
          </section>

          <section className="fa-workspace">
            <div className="fa-findings">
              <header><strong>Detected values</strong><span>Uncheck false positives</span></header>
              {findings.length ? findings.map((finding, index) => (
                <button
                  className={selected.has(finding.id) ? "is-selected" : ""}
                  type="button"
                  key={finding.id}
                  onClick={() => toggle(finding.id)}
                >
                  {selected.has(finding.id) ? <CheckSquareIcon size={19} weight="fill" aria-hidden /> : <SquareIcon size={19} aria-hidden />}
                  <span><strong>{finding.kind}</strong><small>{finding.location}</small></span>
                  <code>{mask(finding.value)}</code>
                  {kind === "csv" && mode === "tokenize" && selected.has(finding.id) && <em>{tokenFor(finding.kind, index)}</em>}
                </button>
              )) : <p>No configured identifiers were detected. Review the source manually before sharing it.</p>}
            </div>

            <aside className="fa-preview">
              <header><strong>Output preview</strong><span>{selectedFindings.length} selected</span></header>
              {kind === "csv" ? <pre>{csvPreview}</pre> : (
                <div className="fa-pdf-preview">
                  <FilePdfIcon size={38} weight="duotone" aria-hidden />
                  <strong>Permanent raster redaction</strong>
                  <span>{selectedFindings.length} regions will be erased in page pixels{mode === "tokenize" ? " and labeled with clipped tokens" : ""} before a new PDF is built.</span>
                </div>
              )}
            </aside>
          </section>

          {kind === "pdf" && (
            <aside className="fa-warning">
              <WarningIcon size={20} aria-hidden />
              <div><strong>Flattened-output tradeoff</strong><span>Every page is rasterized; selectable text, links, forms, accessibility structure, and vector sharpness are lost. This prevents recoverable text beneath visual overlays but may increase file size and reduce quality.</span></div>
            </aside>
          )}

          <section className="fa-export">
            <div><strong>{kind === "pdf" ? "Export flattened PDF" : "Export anonymized CSV"}</strong><span>Only checked findings are changed.</span></div>
            <button type="button" disabled={!selected.size || Boolean(status)} onClick={() => void exportResult()}>
              <DownloadSimpleIcon size={18} aria-hidden /> Export
            </button>
          </section>
        </>
      )}
    </div>
  );
}
