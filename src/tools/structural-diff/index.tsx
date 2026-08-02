import {
  ArrowsLeftRightIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileArrowUpIcon,
  GitDiffIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import {
  diffStructures,
  formatPath,
  mergeStructures,
  parseStructured,
  pathKey,
  serializeStructured,
  valueType,
  type DataFormat,
  type DiffEntry,
  type MergeSide,
} from "./engine";
import "./styles.css";

const SAMPLE_LEFT = `{
  "service": "checkout",
  "enabled": true,
  "limits": {
    "retries": 2,
    "timeout": 1500
  },
  "regions": ["us-east", "eu-west"]
}`;

const SAMPLE_RIGHT = `service: checkout
enabled: true
limits:
  retries: 3
  timeout: "1500"
regions:
  - us-east
  - ap-south
owner: platform`;

function preview(value: unknown): string {
  if (value === undefined) return "Not present";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function TreeNode({ name, value }: { name: string; value: unknown }) {
  const expandable = value !== null && typeof value === "object";
  if (!expandable) {
    return (
      <div className="sd-tree-leaf">
        <span>{name}</span>
        <code>{preview(value)}</code>
      </div>
    );
  }
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item: unknown, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  return (
    <details className="sd-tree-node" open>
      <summary>
        {name} <small>{Array.isArray(value) ? "array" : "object"} ({entries.length})</small>
      </summary>
      <div>
        {entries.map(([key, item]) => <TreeNode key={key} name={key} value={item} />)}
      </div>
    </details>
  );
}

function ChangeRow({
  change,
  choice,
  onChoose,
}: {
  change: DiffEntry;
  choice: MergeSide;
  onChoose: (side: MergeSide) => void;
}) {
  return (
    <article className={`sd-change sd-${change.kind}`}>
      <header>
        <span className="sd-kind">{change.kind}</span>
        <code>{formatPath(change.path)}</code>
        <small>{valueType(change.left)} → {valueType(change.right)}</small>
      </header>
      <div className="sd-choice-grid">
        <button className={choice === "left" ? "is-selected" : ""} onClick={() => onChoose("left")} type="button">
          <span>Keep left</span>
          <pre>{preview(change.left)}</pre>
        </button>
        <button className={choice === "right" ? "is-selected" : ""} onClick={() => onChoose("right")} type="button">
          <span>Use right</span>
          <pre>{preview(change.right)}</pre>
        </button>
      </div>
    </article>
  );
}

export default function StructuralDiff() {
  const [leftText, setLeftText] = useState(SAMPLE_LEFT);
  const [rightText, setRightText] = useState(SAMPLE_RIGHT);
  const [leftFormat, setLeftFormat] = useState<DataFormat>("json");
  const [rightFormat, setRightFormat] = useState<DataFormat>("yaml");
  const [outputFormat, setOutputFormat] = useState<DataFormat>("json");
  const [choices, setChoices] = useState<Record<string, MergeSide>>({});
  const [view, setView] = useState<"changes" | "tree">("changes");
  const leftFile = useRef<HTMLInputElement>(null);
  const rightFile = useRef<HTMLInputElement>(null);

  const result = useMemo(() => {
    try {
      const left = parseStructured(leftText, leftFormat);
      const right = parseStructured(rightText, rightFormat);
      const changes = diffStructures(left, right);
      const merged = mergeStructures(left, changes, choices);
      return { left, right, changes, merged, error: "" };
    } catch (error) {
      return {
        left: undefined,
        right: undefined,
        changes: [] as DiffEntry[],
        merged: undefined,
        error: error instanceof Error ? error.message : "Could not compare these documents.",
      };
    }
  }, [choices, leftFormat, leftText, rightFormat, rightText]);

  const loadFile = async (file: File | undefined, side: "left" | "right") => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    const format: DataFormat = extension === "yaml" || extension === "yml" ? "yaml" : extension === "xml" ? "xml" : "json";
    const text = await file.text();
    if (side === "left") {
      setLeftText(text);
      setLeftFormat(format);
    } else {
      setRightText(text);
      setRightFormat(format);
    }
    setChoices({});
  };

  const chooseAll = (side: MergeSide) => {
    setChoices(Object.fromEntries(result.changes.map((change) => [pathKey(change.path), side])));
  };

  const download = () => {
    if (result.error) return;
    const content = serializeStructured(result.merged, outputFormat);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `merged.${outputFormat === "yaml" ? "yaml" : outputFormat}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sd-app">
      <section className="sd-input-grid" aria-label="Documents to compare">
        {([
          { side: "left" as const, label: "Original", text: leftText, format: leftFormat, fileRef: leftFile },
          { side: "right" as const, label: "Incoming", text: rightText, format: rightFormat, fileRef: rightFile },
        ]).map((panel) => (
          <div className="sd-editor" key={panel.side}>
            <header>
              <div>
                <strong>{panel.label}</strong>
                <small>Paste or open a local file</small>
              </div>
              <div className="sd-editor-actions">
                <select
                  aria-label={`${panel.label} format`}
                  value={panel.format}
                  onChange={(event) => {
                    const next = event.target.value as DataFormat;
                    if (panel.side === "left") setLeftFormat(next);
                    else setRightFormat(next);
                    setChoices({});
                  }}
                >
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                  <option value="xml">XML</option>
                </select>
                <button type="button" title="Open file" onClick={() => panel.fileRef.current?.click()}>
                  <FileArrowUpIcon aria-hidden size={17} />
                  Open
                </button>
                <input
                  ref={panel.fileRef}
                  className="visually-hidden"
                  type="file"
                  accept=".json,.yaml,.yml,.xml"
                  onChange={(event) => void loadFile(event.target.files?.[0], panel.side)}
                />
              </div>
            </header>
            <textarea
              aria-label={`${panel.label} document`}
              spellCheck={false}
              value={panel.text}
              onChange={(event) => {
                if (panel.side === "left") setLeftText(event.target.value);
                else setRightText(event.target.value);
                setChoices({});
              }}
            />
          </div>
        ))}
      </section>

      {result.error ? <div className="sd-error" role="alert">{result.error}</div> : (
        <>
          <section className="sd-toolbar" aria-label="Diff controls">
            <div className="sd-summary">
              <GitDiffIcon aria-hidden size={19} />
              <strong>{result.changes.length}</strong>
              <span>{result.changes.length === 1 ? "change" : "changes"}</span>
            </div>
            <div className="sd-segmented">
              <button className={view === "changes" ? "is-active" : ""} onClick={() => setView("changes")} type="button">
                <ArrowsLeftRightIcon aria-hidden size={16} /> Side by side
              </button>
              <button className={view === "tree" ? "is-active" : ""} onClick={() => setView("tree")} type="button">
                <TreeStructureIcon aria-hidden size={16} /> Tree
              </button>
            </div>
            <div className="sd-bulk">
              <button type="button" onClick={() => chooseAll("left")}>All left</button>
              <button type="button" onClick={() => chooseAll("right")}>All right</button>
            </div>
          </section>

          {result.changes.length === 0 ? (
            <div className="sd-empty">
              <CheckCircleIcon aria-hidden size={28} />
              <strong>These documents match</strong>
              <span>Formatting and key order do not affect the comparison.</span>
            </div>
          ) : view === "changes" ? (
            <section className="sd-changes" aria-label="Changes">
              {result.changes.map((change) => {
                const key = pathKey(change.path);
                return (
                  <ChangeRow
                    key={key}
                    change={change}
                    choice={choices[key] ?? "left"}
                    onChoose={(side) => setChoices((current) => ({ ...current, [key]: side }))}
                  />
                );
              })}
            </section>
          ) : (
            <section className="sd-tree" aria-label="Merged tree">
              <TreeNode name="$ merged" value={result.merged} />
            </section>
          )}

          <section className="sd-export">
            <div>
              <strong>Export merged document</strong>
              <span>Each change uses the highlighted side. Unchanged values stay intact.</span>
            </div>
            <select aria-label="Export format" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as DataFormat)}>
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
              <option value="xml">XML</option>
            </select>
            <button className="sd-primary" onClick={download} type="button">
              <DownloadSimpleIcon aria-hidden size={18} /> Download
            </button>
          </section>
        </>
      )}
    </div>
  );
}
