import { DownloadSimpleIcon, EnvelopeOpenIcon, FileDocIcon, FilePdfIcon, LinkIcon, ShieldWarningIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { download, jsonReport } from "../security-shared/utils";
import { complianceReportHtml, inspectComplianceFile, type ComplianceInspection } from "./engine";
import "./styles.css";

export default function ComplianceGatekeeper() {
  const [report, setReport] = useState<ComplianceInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"findings" | "attachments" | "links" | "text">("findings");
  async function inspect(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setReport(null);
    try { setReport(await inspectComplianceFile(file)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Document inspection failed."); }
    finally { setBusy(false); }
  }
  return (
    <div className="gate-app">
      <header className="gate-hero"><div><span>Inbound document review</span><h2><ShieldWarningIcon weight="duotone" /> Compliance Gatekeeper</h2><p>Inspect document text, links, attachments, classifications, and active-content indicators before human review.</p></div><label><UploadSimpleIcon /> {busy ? "Inspecting…" : "Open document"}<input type="file" disabled={busy} accept=".eml,.docx,.pdf,message/rfc822,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { void inspect(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label></header>
      <aside className="gate-notice"><strong>No execution or detonation.</strong> Parsing is bounded to 20 MB compressed, 250 archive entries, 40 MB expanded, and 200 PDF pages. Signals are heuristic—not antivirus, legal advice, or compliance certification.</aside>
      {error && <p className="gate-error" role="alert">{error}</p>}
      {!report ? <section className="gate-empty"><div><EnvelopeOpenIcon /><FileDocIcon /><FilePdfIcon /></div><strong>Choose an EML, DOCX, or PDF</strong><span>Attachments are hashed and named; macros and embedded active content are never executed.</span></section> : <>
        <section className="gate-summary">
          <article><span>Document</span><strong>{report.name}</strong><small>{report.size.toLocaleString()} bytes</small></article>
          <article><span>Signals</span><strong className={report.findings.length ? "alert" : ""}>{report.findings.length}</strong><small>{report.findings.filter((item) => item.severity === "critical" || item.severity === "high").length} high priority</small></article>
          <article><span>Attachments</span><strong>{report.attachments.length}</strong><small>hashed locally</small></article>
          <article><span>External links</span><strong>{report.links.length}</strong><small>not contacted</small></article>
          <div><button onClick={() => download(jsonReport(report), `${report.name}.gatekeeper.json`, "application/json")}><DownloadSimpleIcon /> JSON</button><button onClick={() => download(complianceReportHtml(report), `${report.name}.gatekeeper.html`, "text/html")}><DownloadSimpleIcon /> HTML</button></div>
        </section>
        <section className="gate-hash"><span>SHA-256</span><code>{report.sha256}</code></section>
        <section className="gate-report">
          <nav>{(["findings", "attachments", "links", "text"] as const).map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}<span>{item === "findings" ? report.findings.length : item === "attachments" ? report.attachments.length : item === "links" ? report.links.length : report.textLength.toLocaleString()}</span></button>)}</nav>
          {tab === "findings" && <div className="gate-findings">{report.findings.map((item) => <article key={item.id}><span className={`gate-${item.severity}`}>{item.severity}</span><div><strong>{item.label}</strong><p>{item.detail}</p>{item.evidence && <code>{item.evidence}</code>}</div></article>)}{!report.findings.length && <div className="gate-clean"><strong>No configured signals matched</strong><span>This does not prove the document is safe or compliant.</span></div>}</div>}
          {tab === "attachments" && <div className="gate-table">{report.attachments.length ? <table><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>{report.attachments.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.mediaType}</td><td>{item.size.toLocaleString()}</td><td><code>{item.sha256}</code></td></tr>)}</tbody></table> : <div className="gate-clean">No attachments or embedded objects found.</div>}</div>}
          {tab === "links" && <div className="gate-links">{report.links.map((link) => <article key={link}><LinkIcon /><code>{link}</code></article>)}{!report.links.length && <div className="gate-clean">No HTTP(S) links found in extracted text.</div>}</div>}
          {tab === "text" && <pre className="gate-text">{report.textPreview || "No extractable text found."}</pre>}
        </section>
      </>}
    </div>
  );
}
