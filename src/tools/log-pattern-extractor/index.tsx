import { DownloadSimpleIcon, PlusIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";
import { Badge, Button, Callout, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import {
  extractLogPatterns,
  rowsToCsv,
  rowsToJson,
  validateRule,
  type ExtractedRow,
  type PatternRule,
} from "./engine";
import "./styles.css";

const SAMPLE = `2026-08-02T06:40:00.143Z INFO request accepted client=192.168.1.42 request_id=8e13c8af-29d4-4d4a-8c4e-7c6d7ee6019e
2026-08-02T06:40:01.902Z WARN retrying upstream client=10.0.0.8 attempt=2
2026-08-02T06:40:03.015Z ERROR TypeError: Cannot read properties of undefined
    at parseUser (server/users.js:42:17)
    at handleRequest (server/index.js:88:5)`;

function saveFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PatternBadge({ value, empty = "Not found" }: { readonly value: string; readonly empty?: string }) {
  return value ? <code className="log-pattern-value">{value}</code> : <span className="log-pattern-muted">{empty}</span>;
}

export default function LogPatternExtractor() {
  const [input, setInput] = useState(SAMPLE);
  const [rules, setRules] = useState<PatternRule[]>([
    { id: "service", name: "service", pattern: "\\bservice=([\\w.-]+)", flags: "i", enabled: true },
  ]);
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [error, setError] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const customColumns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row.custom)))], [rows]);
  const detections = useMemo(() => ({
    timestamps: rows.filter((row) => row.timestamp).length,
    levels: rows.filter((row) => row.level).length,
    ips: rows.filter((row) => row.ip).length,
    uuids: rows.filter((row) => row.uuid).length,
    stacks: rows.filter((row) => row.stackTrace).length,
  }), [rows]);

  const extract = () => {
    try {
      setRows(extractLogPatterns(input, rules));
      setError("");
      setHasRun(true);
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : "The log could not be analyzed.");
      setHasRun(true);
    }
  };

  const updateRule = (id: string, patch: Partial<PatternRule>) => {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  };

  return (
    <div className="log-extractor">
      <section className="log-extractor-input">
        <div className="log-extractor-title">
          <div>
            <strong>Raw logs</strong>
            <Text as="p" size="1" color="gray">Paste up to 300,000 characters. Processing stays in this tab.</Text>
          </div>
          <Button onClick={extract}><SparkleIcon aria-hidden /> Extract patterns</Button>
        </div>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} aria-label="Raw log input" placeholder="Paste log lines here…" />
        <div className="log-extractor-input-footer">
          <Text size="1" color={input.length > 300_000 ? "red" : "gray"}>{input.length.toLocaleString()} / 300,000 characters</Text>
          <button type="button" onClick={() => { setInput(""); setRows([]); setHasRun(false); }}>Clear input</button>
        </div>
      </section>

      {error ? <Callout.Root color="red" role="alert"><Callout.Text>{error}</Callout.Text></Callout.Root> : null}

      <section className="log-rules">
        <div className="log-extractor-title">
          <div><strong>Detection rules</strong><Text as="p" size="1" color="gray">Built-ins recognize common formats. Add capture groups for your own fields.</Text></div>
          <Button size="1" variant="soft" onClick={() => setRules((current) => [...current, { id: crypto.randomUUID(), name: "", pattern: "", flags: "i", enabled: true }])}><PlusIcon aria-hidden /> Add rule</Button>
        </div>
        <div className="log-builtins" aria-label="Built-in detections">
          {["IPv4 / IPv6", "ISO / Apache timestamps", "UUIDs", "Log levels", "Stack traces"].map((label) => <Badge color="gray" variant="soft" key={label}>{label}</Badge>)}
        </div>
        <div className="log-rule-list">
          {rules.map((rule) => {
            const ruleError = rule.pattern || rule.name ? validateRule(rule) : null;
            return (
              <div className="log-rule" key={rule.id}>
                <label className="log-rule-toggle"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /><span className="visually-hidden">Enable rule</span></label>
                <label>Name<input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} placeholder="e.g. service" /></label>
                <label className="log-rule-pattern">Regular expression<input value={rule.pattern} onChange={(event) => updateRule(rule.id, { pattern: event.target.value })} placeholder="service=([\w.-]+)" spellCheck={false} /></label>
                <label>Flags<input className="log-rule-flags" value={rule.flags} onChange={(event) => updateRule(rule.id, { flags: event.target.value })} placeholder="i" /></label>
                <Button aria-label={`Delete ${rule.name || "rule"}`} color="red" variant="ghost" onClick={() => setRules((current) => current.filter((candidate) => candidate.id !== rule.id))}><TrashIcon aria-hidden /></Button>
                {ruleError ? <span className="log-rule-error">{ruleError}</span> : null}
              </div>
            );
          })}
          {!rules.length ? <div className="log-inline-empty">No custom rules. Built-in detection still works.</div> : null}
        </div>
      </section>

      <section className="log-results">
        <div className="log-extractor-title">
          <div><strong>Structured preview</strong><Text as="p" size="1" color="gray">{rows.length ? `${rows.length} source rows extracted` : "Run extraction to build a table."}</Text></div>
          <div className="log-export-actions">
            <Button size="1" variant="soft" disabled={!rows.length} onClick={() => saveFile(rowsToCsv(rows), "log-patterns.csv", "text/csv;charset=utf-8")}><DownloadSimpleIcon aria-hidden /> CSV</Button>
            <Button size="1" variant="soft" disabled={!rows.length} onClick={() => saveFile(rowsToJson(rows), "log-patterns.json", "application/json")}><DownloadSimpleIcon aria-hidden /> JSON</Button>
          </div>
        </div>

        {rows.length ? (
          <>
            <div className="log-stats">
              <span><strong>{detections.timestamps}</strong> timestamps</span>
              <span><strong>{detections.levels}</strong> levels</span>
              <span><strong>{detections.ips}</strong> IPs</span>
              <span><strong>{detections.uuids}</strong> UUIDs</span>
              <span><strong>{detections.stacks}</strong> stack traces</span>
            </div>
            <div className="log-table-wrap">
              <table>
                <thead><tr><th>Line</th><th>Timestamp</th><th>Level</th><th>IP</th><th>UUID</th><th>Stack trace</th>{customColumns.map((column) => <th key={column}>{column}</th>)}<th>Source</th></tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.line}>
                    <td>{row.line}</td>
                    <td><PatternBadge value={row.timestamp} /></td>
                    <td>{row.level ? <span className={`log-level is-${row.level.toLowerCase()}`}>{row.level}</span> : <span className="log-pattern-muted">—</span>}</td>
                    <td><PatternBadge value={row.ip} /></td>
                    <td><PatternBadge value={row.uuid} /></td>
                    <td>{row.stackTrace ? <details><summary>{row.stackTrace.split("\n").length} lines</summary><pre>{row.stackTrace}</pre></details> : <span className="log-pattern-muted">—</span>}</td>
                    {customColumns.map((column) => <td key={column}><PatternBadge value={row.custom[column] ?? ""} /></td>)}
                    <td className="log-source">{row.source}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="log-empty">
            <SparkleIcon aria-hidden size={26} weight="duotone" />
            <strong>{hasRun ? "No structured rows found" : "Ready to find useful fields"}</strong>
            <span>{hasRun ? "Check the input and enabled custom rules, then try again." : "Built-in rules identify network addresses, timestamps, IDs, levels, and stack traces."}</span>
          </div>
        )}
      </section>
    </div>
  );
}
