import { DownloadSimpleIcon, FileZipIcon, MagnifyingGlassIcon, PlusIcon, ShieldCheckIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { download, jsonReport } from "../security-shared/utils";
import { leakReportHtml, scanFiles, scanText, type CustomLeakRule, type LeakScan, type Severity } from "./engine";
import "./styles.css";

export default function LeakScanner() {
  const [text, setText] = useState("");
  const [report, setReport] = useState<LeakScan | null>(null);
  const [custom, setCustom] = useState<CustomLeakRule[]>([]);
  const [entropy, setEntropy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Severity | "all">("all");

  function runText() {
    setError("");
    try {
      setReport({ createdAt: new Date().toISOString(), sources: 1, characters: text.length, findings: scanText(text, "pasted-text", custom, entropy), notes: [] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Scan failed."); }
  }
  async function runFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true); setError("");
    try { setReport(await scanFiles(files, custom, entropy)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Files could not be scanned."); }
    finally { setBusy(false); }
  }
  const shown = useMemo(() => report?.findings.filter((item) => filter === "all" || item.severity === filter) ?? [], [report, filter]);
  const counts = (severity: Severity) => report?.findings.filter((item) => item.severity === severity).length ?? 0;

  return (
    <div className="leak-app">
      <header className="leak-header"><div><span>Privacy engineering</span><h2><MagnifyingGlassIcon /> Leak Scanner</h2><p>Find credential and PII signals in source, logs, text files, and bounded ZIP archives.</p></div><div className="leak-local"><ShieldCheckIcon /><strong>Local only</strong><small>Values masked in results</small></div></header>
      <p className="leak-disclaimer">Pattern and entropy heuristics can be incomplete or wrong. This tool does not validate credentials, contact networks, or certify compliance.</p>
      {error && <p className="leak-error" role="alert">{error}</p>}
      <div className="leak-workspace">
        <aside className="leak-controls">
          <label className="leak-drop"><UploadSimpleIcon size={25} /><strong>{busy ? "Scanning…" : "Scan files or ZIP"}</strong><span>20 MB archive · 250 entries · 40 MB expanded</span><input type="file" multiple disabled={busy} accept=".txt,.log,.json,.jsonl,.env,.yaml,.yml,.xml,.csv,.md,.js,.jsx,.ts,.tsx,.py,.go,.java,.zip" onChange={(event) => { void runFiles([...event.currentTarget.files ?? []]); event.currentTarget.value = ""; }} /></label>
          <div className="leak-divider"><span>or paste text</span></div>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste source code, logs, configuration, or text…" spellCheck={false} />
          <button className="leak-scan" disabled={!text.trim() || busy} onClick={runText}><MagnifyingGlassIcon /> Scan pasted text</button>
          <label className="leak-toggle"><input type="checkbox" checked={entropy} onChange={(event) => setEntropy(event.target.checked)} /><span><strong>Entropy-like candidates</strong><small>Ignore common hashes, placeholders, and low-diversity tokens</small></span></label>
          <section className="leak-custom">
            <header><div><strong>Custom patterns</strong><small>JavaScript regular expressions</small></div><button onClick={() => setCustom([...custom, { name: "Custom signal", pattern: "", severity: "medium" }])}><PlusIcon /></button></header>
            {custom.map((rule, index) => <div className="leak-custom-row" key={index}>
              <input aria-label="Rule name" value={rule.name} onChange={(event) => setCustom(custom.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
              <input aria-label="Regular expression" placeholder="pattern" value={rule.pattern} onChange={(event) => setCustom(custom.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value } : item))} />
              <select aria-label="Severity" value={rule.severity} onChange={(event) => setCustom(custom.map((item, itemIndex) => itemIndex === index ? { ...item, severity: event.target.value as Severity } : item))}><option>high</option><option>medium</option><option>low</option></select>
              <button aria-label="Remove rule" onClick={() => setCustom(custom.filter((_, itemIndex) => itemIndex !== index))}><TrashIcon /></button>
            </div>)}
          </section>
        </aside>
        <main className="leak-results">
          <header><div><strong>Findings</strong><span>{report ? `${report.findings.length} across ${report.sources} source${report.sources === 1 ? "" : "s"}` : "No scan yet"}</span></div><div>{report && <><button onClick={() => download(jsonReport(report), "leak-report.json", "application/json")}><DownloadSimpleIcon /> JSON</button><button onClick={() => download(leakReportHtml(report), "leak-report.html", "text/html")}><DownloadSimpleIcon /> HTML</button></>}</div></header>
          {!report ? <div className="leak-empty"><FileZipIcon size={38} /><strong>Results stay in this tab</strong><span>Choose files or paste text to begin.</span></div> : <>
            <nav className="leak-filters">{(["all", "high", "medium", "low"] as const).map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item} <span>{item === "all" ? report.findings.length : counts(item)}</span></button>)}</nav>
            <div className="leak-list">{shown.map((item) => <article key={item.id}><span className={`sev-${item.severity}`}>{item.severity}</span><div><strong>{item.label}</strong><small>{item.source}:{item.line}:{item.column} · {item.category}</small><code>{item.context}</code></div></article>)}{!shown.length && <div className="leak-clean"><ShieldCheckIcon size={34} /><strong>No configured signals in this view</strong><span>This is not assurance that the content is secret- or PII-free.</span></div>}</div>
            {report.notes.length > 0 && <details className="leak-notes"><summary>Skipped content and notes ({report.notes.length})</summary>{report.notes.map((note) => <p key={note}>{note}</p>)}</details>}
          </>}
        </main>
      </div>
    </div>
  );
}
