import {
  DownloadSimpleIcon,
  FileDocIcon,
  ScalesIcon,
  ShieldWarningIcon,
  SwapIcon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { downloadText } from "../../lib/downloads";
import {
  buildRedlineReport,
  compareDocuments,
  extractDocument,
  flagRiskyChanges,
  type RedlinePart,
} from "./engine";
import "./styles.css";

type DocumentState = { name: string; text: string };

function DocumentInput({
  label,
  document,
  onChange,
}: {
  label: string;
  document: DocumentState;
  onChange: (next: DocumentState) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange({ name: file.name, text: await extractDocument(file) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="dr-source">
      <header>
        <div><strong>{label}</strong><small>{document.name}</small></div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          <FileDocIcon size={17} aria-hidden /> {busy ? "Extracting…" : "Import"}
        </button>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            void open(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </header>
      <textarea
        aria-label={`${label} text`}
        spellCheck={false}
        value={document.text}
        onChange={(event) => onChange({ ...document, text: event.target.value })}
        placeholder={`Import or paste the ${label.toLowerCase()} document`}
      />
      {error && <p className="dr-error" role="alert">{error}</p>}
    </article>
  );
}

function DiffText({ parts }: { parts: RedlinePart[] }) {
  return (
    <div className="dr-diff-text" aria-label="Document redline">
      {parts.map((part, index) => (
        <span className={`dr-${part.kind}`} key={`${index}-${part.value.slice(0, 8)}`}>{part.value}</span>
      ))}
    </div>
  );
}

export default function DocumentRedliner() {
  const [original, setOriginal] = useState<DocumentState>({ name: "original.txt", text: "" });
  const [revised, setRevised] = useState<DocumentState>({ name: "revised.txt", text: "" });
  const parts = useMemo(() => compareDocuments(original.text, revised.text), [original.text, revised.text]);
  const risks = useMemo(() => flagRiskyChanges(parts), [parts]);
  const additions = parts.filter((part) => part.kind === "added");
  const removals = parts.filter((part) => part.kind === "removed");
  const hasDocuments = original.text.length > 0 || revised.text.length > 0;

  return (
    <div className="dr-app">
      <aside className="dr-notice">
        <ScalesIcon size={19} aria-hidden />
        <div><strong>Comparison aid — not legal advice</strong><span>Risk flags are keyword-based and can be incomplete or wrong. Have important terms reviewed by a qualified professional.</span></div>
      </aside>

      <section className="dr-sources">
        <DocumentInput label="Original" document={original} onChange={setOriginal} />
        <DocumentInput label="Revised" document={revised} onChange={setRevised} />
      </section>

      <section className="dr-summary">
        <div><SwapIcon size={19} aria-hidden /><strong>{additions.length + removals.length}</strong><span>change blocks</span></div>
        <div className="dr-added"><strong>+{additions.length}</strong><span>additions</span></div>
        <div className="dr-removed"><strong>−{removals.length}</strong><span>removals</span></div>
        <button
          type="button"
          disabled={!hasDocuments}
          onClick={() => downloadText(
            buildRedlineReport(original.name, revised.name, parts, risks),
            "redline-report.md",
            "text/markdown;charset=utf-8",
          )}
        >
          <DownloadSimpleIcon size={18} aria-hidden /> Export report
        </button>
      </section>

      {!hasDocuments ? (
        <div className="dr-empty"><FileDocIcon size={30} aria-hidden /><strong>Add two documents to compare</strong><span>TXT, Markdown, PDF, and DOCX up to 20 MB each.</span></div>
      ) : (
        <section className="dr-results">
          <article className="dr-redline">
            <header><strong>Inline redline</strong><span>Added text is green; removed text is struck through.</span></header>
            <DiffText parts={parts} />
          </article>
          <aside className="dr-risks">
            <header><ShieldWarningIcon size={20} aria-hidden /><strong>Risk signals</strong><span>{risks.length}</span></header>
            {risks.length ? risks.map((risk) => (
              <article key={risk.id}>
                <strong>{risk.label}</strong>
                <p>{risk.explanation}</p>
                <blockquote>{risk.excerpt}</blockquote>
              </article>
            )) : <p className="dr-no-risks">No configured risk phrases found in added text. This is not an assurance that the revision is safe.</p>}
          </aside>
        </section>
      )}
    </div>
  );
}
