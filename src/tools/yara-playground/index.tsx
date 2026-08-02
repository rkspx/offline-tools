import { BugIcon, CheckCircleIcon, FileArrowUpIcon, GaugeIcon, PlayIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { MAX_SCAN_BYTES, parseYara, SAMPLE_RULES, scanBytes, YARA_SUBSET_LABEL, type ScanResult } from "../security-shared/yara";
import "./styles.css";

const SAMPLE_TEXT = "powershell -EncodedCommand VABlAHMAdAAtAFAAYQB5AGwAbwBhAGQA";

export default function YaraPlayground() {
  const [source, setSource] = useState(SAMPLE_RULES);
  const [sample, setSample] = useState(SAMPLE_TEXT);
  const [sampleName, setSampleName] = useState("sample.txt");
  const [bytes, setBytes] = useState<Uint8Array>(() => new TextEncoder().encode(SAMPLE_TEXT));
  const [result, setResult] = useState<ScanResult | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const parsed = useMemo(() => parseYara(source), [source]);

  function updateSample(value: string) {
    setSample(value);
    setBytes(new TextEncoder().encode(value));
    setSampleName("sample.txt");
    setResult(null);
  }
  async function open(file?: File) {
    if (!file) return;
    if (file.size > MAX_SCAN_BYTES) { setRuntimeError("Sample exceeds the 20 MB limit."); return; }
    const next = new Uint8Array(await file.arrayBuffer());
    setBytes(next); setSample(new TextDecoder().decode(next.slice(0, 200_000))); setSampleName(file.name); setResult(null); setRuntimeError("");
  }
  function run() {
    setRuntimeError("");
    if (parsed.diagnostics.length) return;
    try { setResult(scanBytes(parsed.rules, bytes)); }
    catch (caught) { setRuntimeError(caught instanceof Error ? caught.message : "Rule evaluation failed."); }
  }

  return (
    <div className="yara-app">
      <header className="yara-top"><div><span>Safe static rule lab</span><h2><BugIcon weight="duotone" /> YARA Playground</h2><p>Write, validate, test, debug, and profile a practical browser-compatible rule subset.</p></div><div className="yara-engine"><i /><strong>{YARA_SUBSET_LABEL}</strong><small>No libyara WASM is installed</small></div></header>
      <aside className="yara-warning"><ShieldWarningIcon /><span><strong>Compatibility boundary:</strong> supports metadata, text/hex/regex strings, ascii/nocase/wide, boolean refs, any/all/N of them, filesize, and little-endian uint8/16/32 checks. No modules, imports, includes, loops, external variables, PE parsing, or full YARA grammar.</span></aside>
      <div className="yara-toolbar"><div className={parsed.diagnostics.length ? "invalid" : "valid"}>{parsed.diagnostics.length ? <BugIcon /> : <CheckCircleIcon />}{parsed.diagnostics.length ? `${parsed.diagnostics.length} validation issue${parsed.diagnostics.length === 1 ? "" : "s"}` : `${parsed.rules.length} rules valid`}</div><button disabled={parsed.diagnostics.length > 0} onClick={run}><PlayIcon weight="fill" /> Run rules</button></div>
      <div className="yara-workspace">
        <section className="yara-editor">
          <header><strong>Rules</strong><span>Cmd/Ctrl + Enter to run</span></header>
          <div className="yara-code"><pre aria-hidden>{source.split("\n").map((_, index) => `${index + 1}\n`)}</pre><textarea aria-label="YARA rules" value={source} spellCheck={false} onChange={(event) => { setSource(event.target.value); setResult(null); }} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); run(); } }} /></div>
          <div className="yara-diagnostics">{parsed.diagnostics.length ? parsed.diagnostics.map((item, index) => <p key={`${item.line}-${index}`}><strong>Line {item.line}</strong>{item.message}</p>) : <p className="ok"><CheckCircleIcon /> Parser validation passed</p>}</div>
        </section>
        <section className="yara-sample">
          <header><div><strong>Test sample</strong><span>{sampleName} · {bytes.byteLength.toLocaleString()} bytes</span></div><label><FileArrowUpIcon /> Open file<input type="file" onChange={(event) => { void open(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label></header>
          <textarea aria-label="Test sample" value={sample} spellCheck={false} onChange={(event) => updateSample(event.target.value)} />
          <footer>Binary file display is truncated to 200,000 decoded characters; scanning uses the original bytes.</footer>
        </section>
        <section className="yara-results">
          <header><div><strong>Debugger & profile</strong><span>{result ? `${result.elapsedMs.toFixed(3)} ms total` : "Run rules to inspect matches"}</span></div><GaugeIcon /></header>
          {runtimeError && <p className="yara-runtime-error">{runtimeError}</p>}
          {!result ? <div className="yara-empty"><PlayIcon size={32} /><span>Validated rules are ready to run.</span></div> : <div className="yara-rule-results">{result.rules.map((rule) => (
            <article className={rule.matched ? "matched" : ""} key={rule.rule}><div><span>{rule.matched ? "MATCH" : "NO MATCH"}</span><strong>{rule.rule}</strong><small>{rule.elapsedMs.toFixed(3)} ms</small></div><p>{String(rule.meta.description ?? "No description")}</p>
              {rule.matches.length ? <table><thead><tr><th>String</th><th>Offset</th><th>Length</th><th>Preview</th></tr></thead><tbody>{rule.matches.slice(0, 100).map((match, index) => <tr key={`${match.id}-${match.offset}-${index}`}><td>{match.id}</td><td>0x{match.offset.toString(16)}</td><td>{match.length}</td><td>{match.preview}</td></tr>)}</tbody></table> : <small>No string hits.</small>}
            </article>
          ))}</div>}
        </section>
      </div>
    </div>
  );
}
