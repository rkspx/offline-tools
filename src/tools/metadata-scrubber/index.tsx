import {
  DownloadSimpleIcon,
  FileImageIcon,
  MapPinIcon,
  ShieldCheckIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import JSZip from "jszip";
import { useEffect, useRef, useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { downloadBlob } from "../../lib/downloads";
import {
  readMetadata,
  renderFilename,
  resolveOutputMime,
  scrubImage,
  type MetadataReport,
  type OutputFormat,
} from "./engine";
import "./styles.css";

type ImageItem = {
  id: number;
  file: File;
  previewUrl: string;
  report?: MetadataReport;
  status: "reading" | "ready" | "processing" | "done" | "error";
  error?: string;
};

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "preserve", label: "Preserve JPEG / PNG / WebP when supported" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
];

function withoutError(item: ImageItem, status: ImageItem["status"]): ImageItem {
  const next = { ...item, status };
  delete next.error;
  return next;
}

export default function MetadataScrubber() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [format, setFormat] = useState<OutputFormat>("preserve");
  const [template, setTemplate] = useState("{name}-clean-{index}.{ext}");
  const [quality, setQuality] = useState(92);
  const [batchError, setBatchError] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const urls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  const addFiles = (files: readonly File[]) => {
    setBatchError("");
    const added = files.map((file): ImageItem => {
      const previewUrl = URL.createObjectURL(file);
      urls.current.add(previewUrl);
      return { id: nextId.current++, file, previewUrl, status: "reading" };
    });
    setItems((current) => [...current, ...added]);
    for (const item of added) {
      void readMetadata(item.file).then((report) => {
        setItems((current) => current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, report, status: "ready" } : candidate,
        ));
      });
    }
  };

  const removeItem = (id: number) => {
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        urls.current.delete(removed.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const clearAll = () => {
    for (const item of items) {
      URL.revokeObjectURL(item.previewUrl);
      urls.current.delete(item.previewUrl);
    }
    setItems([]);
    setBatchError("");
  };

  const processBatch = async () => {
    if (!items.length || !template.trim()) {
      setBatchError(!items.length ? "Add at least one image." : "Enter a rename template.");
      return;
    }
    setBusy(true);
    setBatchError("");
    const zip = new JSZip();
    const usedNames = new Set<string>();
    let successCount = 0;
    for (const [index, item] of items.entries()) {
      setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? withoutError(candidate, "processing") : candidate,
      ));
      try {
        const result = await scrubImage(item.file, format, quality / 100);
        let filename = renderFilename(template, item.file, index, result.mime);
        if (usedNames.has(filename.toLowerCase())) {
          filename = renderFilename(`${template.replace(/\.\{ext\}$/i, "")}-{index}.{ext}`, item.file, index, result.mime);
        }
        usedNames.add(filename.toLowerCase());
        zip.file(filename, result.blob);
        successCount += 1;
        setItems((current) => current.map((candidate) =>
          candidate.id === item.id ? withoutError(candidate, "done") : candidate,
        ));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image processing failed.";
        setItems((current) => current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, status: "error", error: message } : candidate,
        ));
      }
    }
    try {
      if (!successCount) throw new Error("No images could be scrubbed.");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      downloadBlob(blob, "metadata-scrubbed-images.zip");
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : "ZIP export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meta-app">
      <section className="meta-notice">
        <WarningCircleIcon aria-hidden size={19} />
        <div>
          <strong>Images are decoded and re-encoded</strong>
          <span>This removes embedded metadata but may change compression, color profiles, animation, and file size. HEIC/HEIF is not supported; convert it first.</span>
        </div>
      </section>

      <section className="meta-controls">
        <div className="meta-drop">
          <FileDrop
            accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/*"
            multiple
            disabled={busy}
            onFiles={addFiles}
          />
        </div>
        <div className="meta-options">
          <label>
            Output format
            <select value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as OutputFormat)}>
              {FORMATS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Rename template
            <input value={template} disabled={busy} onChange={(event) => setTemplate(event.target.value)} />
            <small>Variables: {"{name} {index} {date} {ext}"}</small>
          </label>
          <label>
            Lossy quality <span>{quality}%</span>
            <input type="range" min="40" max="100" value={quality} disabled={busy} onChange={(event) => setQuality(Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="meta-batch">
        <header>
          <div>
            <strong>Metadata report</strong>
            <span>{items.length ? `${items.length} image${items.length === 1 ? "" : "s"} queued` : "Add images to inspect embedded metadata."}</span>
          </div>
          {items.length > 0 && <button type="button" disabled={busy} onClick={clearAll}>Clear all</button>}
        </header>

        {!items.length ? <div className="meta-empty"><FileImageIcon aria-hidden size={30} /> No images selected</div> : (
          <div className="meta-list">
            {items.map((item, index) => {
              const outputMime = (() => {
                try { return resolveOutputMime(item.file, format); } catch { return null; }
              })();
              const outputName = outputMime ? renderFilename(template || "{name}", item.file, index, outputMime) : "Unsupported output";
              return (
                <article className="meta-item" key={item.id}>
                  <img src={item.previewUrl} alt="" />
                  <div className="meta-file">
                    <strong title={item.file.name}>{item.file.name}</strong>
                    <span>{(item.file.size / 1024).toFixed(1)} KB → {outputName}</span>
                    {item.report?.latitude !== undefined && item.report.longitude !== undefined && (
                      <span className="meta-gps"><MapPinIcon aria-hidden size={14} /> GPS: {item.report.latitude.toFixed(6)}, {item.report.longitude.toFixed(6)}</span>
                    )}
                    {item.error && <span className="meta-error">{item.error}</span>}
                  </div>
                  <div className="meta-tags">
                    {item.status === "reading" && <span>Reading…</span>}
                    {item.report?.error && <span className="is-warning">Report unavailable</span>}
                    {item.report && !item.report.error && (
                      <details>
                        <summary>{item.report.entries.length} metadata fields</summary>
                        <dl>
                          {item.report.entries.map((entry) => (
                            <div key={entry.key}><dt>{entry.key}</dt><dd>{entry.value}</dd></div>
                          ))}
                        </dl>
                      </details>
                    )}
                    {item.status === "done" && <span className="is-done"><ShieldCheckIcon aria-hidden size={14} /> Scrubbed</span>}
                  </div>
                  <button className="meta-remove" type="button" disabled={busy} aria-label={`Remove ${item.file.name}`} onClick={() => removeItem(item.id)}>
                    <TrashIcon aria-hidden size={17} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <footer>
          <div>
            <span>Canvas applies embedded orientation where the browser decoder supports it.</span>
            {batchError && <span className="meta-error" role="alert">{batchError}</span>}
          </div>
          <button className="meta-primary" type="button" disabled={!items.length || busy} onClick={() => void processBatch()}>
            <DownloadSimpleIcon aria-hidden size={18} /> {busy ? "Creating ZIP…" : "Scrub & download ZIP"}
          </button>
        </footer>
      </section>
    </div>
  );
}
