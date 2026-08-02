import { DownloadSimpleIcon, FileSearchIcon, ShieldWarningIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { download, jsonReport } from "../security-shared/utils";
import { artifactReportHtml, inspectArtifact, type ArtifactReport } from "./engine";
import "./styles.css";

export default function ArtifactInspector() {
  const [report, setReport] = useState<ArtifactReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<"hex" | "text">("hex");

  async function inspect(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      setReport(await inspectArtifact(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The file could not be inspected.");
    } finally {
      setBusy(false);
    }
  }

  const matched = report?.scan.rules.filter((rule) => rule.matched) ?? [];
  return (
    <div className="artifact-app">
      <header className="artifact-hero">
        <div><span className="artifact-kicker">Local binary triage</span><h2><FileSearchIcon weight="duotone" /> Artifact Inspector</h2><p>Inspect hashes, readable content, and curated safe indicators without uploading or executing files.</p></div>
        <label className="artifact-upload"><UploadSimpleIcon /> {busy ? "Inspecting…" : "Choose file"}<input type="file" disabled={busy} onChange={(event) => { void inspect(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
      </header>
      <aside className="artifact-notice"><ShieldWarningIcon /><span><strong>Heuristic inspection, not antivirus.</strong> Files are never executed. A clean result does not establish safety; a match is a review signal, not proof of malware.</span></aside>
      {error && <p className="artifact-error" role="alert">{error}</p>}
      {!report ? <section className="artifact-empty"><FileSearchIcon size={42} /><strong>Choose a file up to 20 MB</strong><span>Any binary or text format · processed only in this browser tab</span></section> : (
        <>
          <section className="artifact-facts">
            <article><span>File</span><strong>{report.name}</strong><small>{report.type}</small></article>
            <article><span>Size</span><strong>{report.size.toLocaleString()}</strong><small>bytes</small></article>
            <article><span>Rules matched</span><strong className={matched.length ? "is-alert" : ""}>{matched.length}</strong><small>of {report.scan.rules.length}</small></article>
            <article><span>Scan time</span><strong>{report.scan.elapsedMs.toFixed(2)}</strong><small>milliseconds</small></article>
          </section>
          <section className="artifact-hash"><span>SHA-256</span><code>{report.sha256}</code></section>
          <div className="artifact-grid">
            <section className="artifact-panel">
              <header><div><strong>Detection signals</strong><span>Curated, non-destructive rules</span></div><div className="artifact-actions"><button onClick={() => download(jsonReport(report), `${report.name}.inspection.json`, "application/json")}>JSON</button><button onClick={() => download(artifactReportHtml(report), `${report.name}.inspection.html`, "text/html")}><DownloadSimpleIcon /> HTML</button></div></header>
              <div className="artifact-rules">{report.scan.rules.map((rule) => (
                <article className={rule.matched ? "matched" : ""} key={rule.rule}>
                  <span>{rule.matched ? "MATCH" : "CLEAR"}</span><div><strong>{rule.rule.replaceAll("_", " ")}</strong><p>{String(rule.meta.description ?? "")}</p></div><small>{rule.matches.length} hit{rule.matches.length === 1 ? "" : "s"} · {rule.elapsedMs.toFixed(2)} ms</small>
                  {rule.matches.length ? <ul>{rule.matches.slice(0, 8).map((item, index) => <li key={`${item.id}-${item.offset}-${index}`}><code>{item.id}</code> at <code>0x{item.offset.toString(16)}</code> <q>{item.preview}</q></li>)}</ul> : null}
                </article>
              ))}</div>
            </section>
            <section className="artifact-panel artifact-preview">
              <header><div><strong>Static preview</strong><span>First {preview === "hex" ? "512 bytes" : "4,000 decoded characters"}</span></div><div className="artifact-tabs"><button className={preview === "hex" ? "active" : ""} onClick={() => setPreview("hex")}>Hex</button><button className={preview === "text" ? "active" : ""} onClick={() => setPreview("text")}>Text</button></div></header>
              <pre>{preview === "hex" ? report.hex : report.text}</pre>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
