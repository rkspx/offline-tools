import {
  BracketsCurlyIcon,
  CodeIcon,
  FloppyDiskIcon,
  GitDiffIcon,
  MagnifyingGlassIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Button, Callout, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import {
  compareText,
  jsonToTypeScript,
  parseLogs,
  runRegex,
  transformJson,
  type DiffRow,
  type LogRow,
  type RegexMatch,
} from "./engine";
import { loadSnippets, saveSnippets, type Snippet } from "./storage";
import "./styles.css";

type ToolTab = "json" | "regex" | "types" | "logs" | "diff";

const tabs: { id: ToolTab; label: string; icon: typeof CodeIcon }[] = [
  { id: "json", label: "JSON", icon: BracketsCurlyIcon },
  { id: "regex", label: "Regex", icon: MagnifyingGlassIcon },
  { id: "types", label: "JSON → TypeScript", icon: CodeIcon },
  { id: "logs", label: "Log parser", icon: TerminalWindowIcon },
  { id: "diff", label: "Text diff", icon: GitDiffIcon },
];

const examples: Record<ToolTab, string> = {
  json: '{"project":"minitools","private":true,"tools":["formatter","regex tester"]}',
  regex: "Order A-104 shipped\nOrder B-207 pending\nNo order on this line",
  types: '{"user":{"id":42,"name":"Ada","roles":["admin","editor"]},"active":true}',
  logs: '2026-08-02T06:40:00Z INFO request complete status=200 duration=31ms\n{"time":"2026-08-02T06:40:01Z","level":"error","message":"request failed","code":"E_TIMEOUT"}',
  diff: "",
};

function ErrorMessage({ message }: { readonly message: string }) {
  return message ? (
    <Callout.Root color="red" role="alert" size="1">
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  ) : null;
}

function CodeArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="devtools-code-area" spellCheck={false} {...props} />;
}

function ResultHeader({ title, value }: { readonly title: string; readonly value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="devtools-result-header">
      <strong>{title}</strong>
      <Button
        size="1"
        variant="soft"
        disabled={!value}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function JsonPanel({ value, setValue }: { readonly value: string; readonly setValue: (value: string) => void }) {
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const transform = (mode: "format" | "minify") => {
    try {
      setResult(transformJson(value, mode));
      setError("");
    } catch (reason) {
      setResult("");
      setError(reason instanceof Error ? reason.message : "Invalid JSON.");
    }
  };
  return (
    <div className="devtools-grid">
      <section className="devtools-panel">
        <label htmlFor="json-input"><strong>JSON input</strong></label>
        <CodeArea id="json-input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste JSON here…" />
        <div className="devtools-actions">
          <Button onClick={() => transform("format")}>Format & validate</Button>
          <Button variant="soft" onClick={() => transform("minify")}>Minify</Button>
        </div>
        <ErrorMessage message={error} />
      </section>
      <section className="devtools-panel">
        <ResultHeader title="Result" value={result} />
        {result ? <CodeArea readOnly value={result} aria-label="JSON result" /> : <div className="devtools-empty">Run the formatter to see valid JSON here.</div>}
      </section>
    </div>
  );
}

function RegexPanel({ value, setValue }: { readonly value: string; readonly setValue: (value: string) => void }) {
  const [pattern, setPattern] = useState("(Order)\\s+([A-Z]-\\d+)");
  const [flags, setFlags] = useState("gi");
  const [matches, setMatches] = useState<RegexMatch[]>([]);
  const [error, setError] = useState("");
  const test = () => {
    try {
      setMatches(runRegex(pattern, flags, value));
      setError("");
    } catch (reason) {
      setMatches([]);
      setError(reason instanceof Error ? reason.message : "The expression could not be evaluated.");
    }
  };
  return (
    <div className="devtools-stack">
      <section className="devtools-panel">
        <div className="devtools-regex-controls">
          <label>Pattern<input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="e.g. \bERROR\b" /></label>
          <label>Flags<input value={flags} onChange={(event) => setFlags(event.target.value)} placeholder="gim" /></label>
          <Button onClick={test}>Test expression</Button>
        </div>
        <CodeArea value={value} onChange={(event) => setValue(event.target.value)} aria-label="Regex test text" placeholder="Paste test text…" />
        <ErrorMessage message={error} />
      </section>
      <section className="devtools-panel">
        <div className="devtools-result-header"><strong>Matches</strong><Text color="gray" size="2">{matches.length} found</Text></div>
        {matches.length ? (
          <div className="devtools-table-wrap"><table><thead><tr><th>#</th><th>Index</th><th>Match</th><th>Capture groups</th></tr></thead>
            <tbody>{matches.map((match, index) => <tr key={`${match.index}-${index}`}><td>{index + 1}</td><td>{match.index}</td><td><code>{match.value || "∅"}</code></td><td>{match.groups.map((group, groupIndex) => <code key={groupIndex}>{group || "∅"}</code>)}</td></tr>)}</tbody>
          </table></div>
        ) : <div className="devtools-empty">No matches yet. Test a pattern to inspect each result and capture group.</div>}
      </section>
    </div>
  );
}

function TypePanel({ value, setValue }: { readonly value: string; readonly setValue: (value: string) => void }) {
  const [name, setName] = useState("Root");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const generate = () => {
    try {
      setResult(jsonToTypeScript(value, name));
      setError("");
    } catch (reason) {
      setResult("");
      setError(reason instanceof Error ? reason.message : "Invalid JSON.");
    }
  };
  return (
    <div className="devtools-grid">
      <section className="devtools-panel">
        <label>Root type name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <CodeArea value={value} onChange={(event) => setValue(event.target.value)} aria-label="JSON for TypeScript" />
        <Button onClick={generate}>Generate types</Button>
        <ErrorMessage message={error} />
      </section>
      <section className="devtools-panel"><ResultHeader title="TypeScript" value={result} />{result ? <CodeArea readOnly value={result} aria-label="Generated TypeScript" /> : <div className="devtools-empty">Generated interfaces will appear here.</div>}</section>
    </div>
  );
}

function LogsPanel({ value, setValue }: { readonly value: string; readonly setValue: (value: string) => void }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [error, setError] = useState("");
  return (
    <div className="devtools-stack">
      <section className="devtools-panel">
        <CodeArea value={value} onChange={(event) => setValue(event.target.value)} aria-label="Log input" placeholder="Paste plain-text or JSON Lines logs…" />
        <Button onClick={() => { try { setRows(parseLogs(value)); setError(""); } catch (reason) { setRows([]); setError(reason instanceof Error ? reason.message : "Could not parse logs."); } }}>Parse log lines</Button>
        <ErrorMessage message={error} />
      </section>
      <section className="devtools-panel">
        <div className="devtools-result-header"><strong>Structured rows</strong><Text color="gray" size="2">{rows.length} rows</Text></div>
        {rows.length ? <div className="devtools-table-wrap"><table><thead><tr><th>Line</th><th>Timestamp</th><th>Level</th><th>Message</th><th>Fields</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.timestamp || "—"}</td><td><span className={`devtools-level is-${row.level.toLowerCase()}`}>{row.level || "—"}</span></td><td>{row.message}</td><td><code>{Object.entries(row.fields).map(([key, field]) => `${key}=${field}`).join(" ") || "—"}</code></td></tr>)}
        </tbody></table></div> : <div className="devtools-empty">Parse logs to turn each line into timestamp, level, message, and fields.</div>}
      </section>
    </div>
  );
}

function DiffPanel({ left, setLeft }: { readonly left: string; readonly setLeft: (value: string) => void }) {
  const [right, setRight] = useState("");
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [error, setError] = useState("");
  return (
    <div className="devtools-stack">
      <section className="devtools-grid">
        <div className="devtools-panel"><strong>Original</strong><CodeArea value={left} onChange={(event) => setLeft(event.target.value)} aria-label="Original text" placeholder="Original text…" /></div>
        <div className="devtools-panel"><strong>Changed</strong><CodeArea value={right} onChange={(event) => setRight(event.target.value)} aria-label="Changed text" placeholder="Changed text…" /></div>
      </section>
      <Button className="devtools-fit" onClick={() => { try { setRows(compareText(left, right)); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not compare text."); } }}>Compare text</Button>
      <ErrorMessage message={error} />
      <section className="devtools-panel">
        <strong>Line changes</strong>
        {rows.length ? <pre className="devtools-diff">{rows.map((row, index) => <span className={`is-${row.kind}`} key={index}>{row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "} {row.value || " "}</span>)}</pre> : <div className="devtools-empty">Compare both versions to see added and removed lines.</div>}
      </section>
    </div>
  );
}

export default function DevtoolsStudio() {
  const [active, setActive] = useState<ToolTab>("json");
  const [values, setValues] = useState<Record<ToolTab, string>>(examples);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetName, setSnippetName] = useState("");
  useEffect(() => { void loadSnippets().then(setSnippets); }, []);
  const value = values[active];
  const setValue = (next: string) => setValues((current) => ({ ...current, [active]: next }));
  const activeSnippets = useMemo(() => snippets.filter((snippet) => snippet.tool === active), [active, snippets]);
  const persist = (next: Snippet[]) => { setSnippets(next); void saveSnippets(next); };

  return (
    <div className="devtools-studio">
      <div className="devtools-toolbar">
        <nav className="devtools-tabs" aria-label="Developer tools">
          {tabs.map((tab) => <button className={active === tab.id ? "is-active" : ""} key={tab.id} onClick={() => setActive(tab.id)}><tab.icon aria-hidden size={16} />{tab.label}</button>)}
        </nav>
        <div className="devtools-snippets">
          <label className="visually-hidden" htmlFor="snippet-name">Snippet name</label>
          <input id="snippet-name" value={snippetName} onChange={(event) => setSnippetName(event.target.value)} placeholder="Snippet name" />
          <Button size="1" variant="soft" disabled={!snippetName.trim() || !value} onClick={() => {
            const snippet: Snippet = { id: crypto.randomUUID(), name: snippetName.trim(), tool: active, content: value, updatedAt: new Date().toISOString() };
            persist([snippet, ...snippets]); setSnippetName("");
          }}><FloppyDiskIcon aria-hidden /> Save</Button>
          <select aria-label="Saved snippets" value="" onChange={(event) => { const found = snippets.find((snippet) => snippet.id === event.target.value); if (found) setValue(found.content); }}>
            <option value="">{activeSnippets.length ? "Load snippet…" : "No saved snippets"}</option>
            {activeSnippets.map((snippet) => <option value={snippet.id} key={snippet.id}>{snippet.name}</option>)}
          </select>
          <Button size="1" color="red" variant="ghost" disabled={!activeSnippets.length} onClick={() => persist(snippets.filter((snippet) => snippet.tool !== active))}><TrashIcon aria-hidden /> Clear</Button>
        </div>
      </div>
      {active === "json" ? <JsonPanel value={value} setValue={setValue} /> : null}
      {active === "regex" ? <RegexPanel value={value} setValue={setValue} /> : null}
      {active === "types" ? <TypePanel value={value} setValue={setValue} /> : null}
      {active === "logs" ? <LogsPanel value={value} setValue={setValue} /> : null}
      {active === "diff" ? <DiffPanel left={value} setLeft={setValue} /> : null}
      <Text className="devtools-privacy" as="p" size="1" color="gray">Inputs and saved snippets stay in this browser. Nothing is uploaded.</Text>
    </div>
  );
}
