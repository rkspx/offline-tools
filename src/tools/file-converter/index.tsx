import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import JSZip from "jszip";
import { useRef, useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { downloadBlob } from "../../lib/downloads";
import {
  audioToWav,
  classifyFile,
  convertImage,
  imagesToPdf,
  mergePdfs,
  splitPdf,
  stem,
  unsupportedReason,
  type ImageOutput,
} from "./engine";
import "./styles.css";

type Operation = "image" | "images-pdf" | "merge-pdf" | "split-pdf" | "audio";
type QueueItem = {
  id: number;
  file: File;
  status: "queued" | "processing" | "done" | "error";
  progress: number;
  output?: Blob;
  outputName?: string;
  error?: string;
};

const OPERATIONS: { value: Operation; label: string; detail: string; accept: string }[] = [
  { value: "image", label: "Image conversion", detail: "JPEG, PNG, WebP, GIF, BMP, HEIC/HEIF → JPEG or PNG", accept: "image/*,.heic,.heif" },
  { value: "images-pdf", label: "Images to PDF", detail: "One image per page, in queue order", accept: "image/*,.heic,.heif" },
  { value: "merge-pdf", label: "Merge PDFs", detail: "Combine complete PDFs in queue order", accept: ".pdf,application/pdf" },
  { value: "split-pdf", label: "Split PDF", detail: "Export every page as a separate PDF", accept: ".pdf,application/pdf" },
  { value: "audio", label: "Audio to WAV", detail: "Any codec this browser's Web Audio decoder accepts → PCM WAV", accept: "audio/*" },
];

const formatSize = (bytes: number) => bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;

function expectedKind(operation: Operation): "image" | "pdf" | "audio" {
  if (operation === "image" || operation === "images-pdf") return "image";
  if (operation === "audio") return "audio";
  return "pdf";
}

function operationDefinition(operation: Operation) {
  const definition = OPERATIONS.find((item) => item.value === operation);
  if (!definition) throw new Error(`Unknown operation: ${operation}`);
  return definition;
}

function hasOutput(item: QueueItem): item is QueueItem & { output: Blob; outputName: string } {
  return Boolean(item.output && item.outputName);
}

export default function FileConverter() {
  const [operation, setOperation] = useState<Operation>("image");
  const [imageOutput, setImageOutput] = useState<ImageOutput>("image/jpeg");
  const [quality, setQuality] = useState(90);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const nextId = useRef(1);
  const selectedOperation = operationDefinition(operation);

  const update = (id: number, patch: Partial<QueueItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const addFiles = (files: readonly File[]) => {
    setMessage("");
    const kind = expectedKind(operation);
    const added = files.map((file): QueueItem => {
      const reason = unsupportedReason(file);
      const mismatch = !reason && classifyFile(file) !== kind
        ? `This ${classifyFile(file)} file does not match the selected ${selectedOperation.label.toLowerCase()} operation.`
        : reason;
      return mismatch
        ? { id: nextId.current++, file, status: "error", progress: 0, error: mismatch }
        : { id: nextId.current++, file, status: "queued", progress: 0 };
    });
    setItems((current) => operation === "split-pdf" ? added.slice(0, 1) : [...current, ...added]);
    if (operation === "split-pdf" && files.length > 1) setMessage("Split PDF accepts one file at a time; only the first file was queued.");
  };

  const changeOperation = (value: Operation) => {
    setOperation(value);
    setItems([]);
    setMessage("");
  };

  const run = async () => {
    const ready = items.filter((item) => item.status !== "error");
    if (!ready.length) {
      setMessage("Add compatible files before converting.");
      return;
    }
    if (operation === "merge-pdf" && ready.length < 2) {
      setMessage("PDF merge needs at least two files.");
      return;
    }
    setBusy(true);
    setMessage("");
    setItems((current) => current.map((item) => item.status === "error" ? item : { ...item, status: "queued", progress: 0 }));
    try {
      if (operation === "images-pdf" || operation === "merge-pdf") {
        ready.forEach((item) => update(item.id, { status: "processing", progress: 20 }));
        const output = operation === "images-pdf"
          ? await imagesToPdf(ready.map((item) => item.file))
          : await mergePdfs(ready.map((item) => item.file));
        const owner = ready[0];
        if (!owner) throw new Error("No files are ready to convert.");
        update(owner.id, {
          status: "done",
          progress: 100,
          output,
          outputName: operation === "images-pdf" ? "images.pdf" : "merged.pdf",
        });
        ready.slice(1).forEach((item) => update(item.id, { status: "done", progress: 100 }));
      } else if (operation === "split-pdf") {
        const item = ready[0];
        if (!item) throw new Error("No PDF is ready to split.");
        update(item.id, { status: "processing", progress: 20 });
        const pages = await splitPdf(item.file);
        const zip = new JSZip();
        pages.forEach((page, index) => zip.file(`${stem(item.file.name)}-page-${String(index + 1).padStart(3, "0")}.pdf`, page));
        update(item.id, { status: "processing", progress: 80 });
        const output = await zip.generateAsync({ type: "blob", compression: "STORE" });
        update(item.id, { status: "done", progress: 100, output, outputName: `${stem(item.file.name)}-pages.zip` });
      } else {
        for (const item of ready) {
          update(item.id, { status: "processing", progress: 15 });
          try {
            const output = operation === "image"
              ? await convertImage(item.file, imageOutput, quality / 100)
              : await audioToWav(item.file);
            const outputName = `${stem(item.file.name)}.${operation === "image" ? (imageOutput === "image/jpeg" ? "jpg" : "png") : "wav"}`;
            update(item.id, { status: "done", progress: 100, output, outputName });
          } catch (error) {
            update(item.id, {
              status: "error",
              progress: 0,
              error: error instanceof Error ? error.message : "Conversion failed.",
            });
          }
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Conversion failed.";
      setMessage(text);
      setItems((current) => current.map((item) => item.status === "processing" ? { ...item, status: "error", progress: 0, error: text } : item));
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = async () => {
    const outputs = items.filter(hasOutput);
    if (outputs.length === 1) {
      const first = outputs[0];
      if (!first) return;
      downloadBlob(first.output, first.outputName);
      return;
    }
    const zip = new JSZip();
    outputs.forEach((item) => zip.file(item.outputName, item.output));
    downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }), "converted-files.zip");
  };

  const completed = items.filter(hasOutput);
  const totalProgress = items.length ? Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length) : 0;

  return (
    <div className="fc-app">
      <section className="fc-operations" aria-label="Conversion type">
        {OPERATIONS.map((item) => (
          <button key={item.value} type="button" className={operation === item.value ? "is-active" : ""} disabled={busy} onClick={() => changeOperation(item.value)}>
            <strong>{item.label}</strong><span>{item.detail}</span>
          </button>
        ))}
      </section>

      <section className="fc-workbench">
        <div className="fc-drop">
          <FileDrop accept={selectedOperation.accept} multiple={operation !== "split-pdf"} disabled={busy} onFiles={addFiles} />
          <p>Local only · 150 MB per file · 40 MP image canvas limit</p>
        </div>
        <div className="fc-settings">
          <div>
            <strong>{selectedOperation.label}</strong>
            <span>{selectedOperation.detail}</span>
          </div>
          {operation === "image" && (
            <>
              <label>Output format
                <select value={imageOutput} disabled={busy} onChange={(event) => setImageOutput(event.target.value as ImageOutput)}>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/png">PNG</option>
                </select>
              </label>
              <label>JPEG quality <span>{quality}%</span>
                <input type="range" min="40" max="100" value={quality} disabled={busy || imageOutput !== "image/jpeg"} onChange={(event) => setQuality(Number(event.target.value))} />
              </label>
            </>
          )}
          <div className="fc-support">
            {operation === "audio" ? "Output is uncompressed 16-bit PCM WAV. Video, trim, codec selection, and compressed audio output are not supported here."
              : operation.includes("pdf") ? "Encrypted or malformed PDFs may be rejected. Layout editing, OCR, PDF-to-image, and compression are not provided."
                : "Canvas supports still images only. GIF animation is flattened. JPEG transparency becomes white. HEIC uses the installed heic2any decoder."}
          </div>
        </div>
      </section>

      <section className="fc-queue">
        <header>
          <div><strong>Queue</strong><span>{items.length ? `${items.length} file${items.length === 1 ? "" : "s"} · ${totalProgress}% overall` : "No files selected"}</span></div>
          {items.length > 0 && <button type="button" disabled={busy} onClick={() => { setItems([]); setMessage(""); }}><TrashIcon size={16} /> Clear</button>}
        </header>
        {!items.length ? <div className="fc-empty"><FileIcon size={30} /> Choose files to begin.</div> : (
          <div className="fc-list">
            {items.map((item) => (
              <article key={item.id}>
                <div className="fc-file-icon"><FileIcon size={20} /></div>
                <div className="fc-file">
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <span>{formatSize(item.file.size)}{item.output ? ` → ${formatSize(item.output.size)}` : ""}</span>
                  <div className="fc-progress"><i style={{ width: `${item.progress}%` }} /></div>
                  {item.error && <small role="alert">{item.error}</small>}
                </div>
                <div className={`fc-status is-${item.status}`}>
                  {item.status === "done" ? <CheckCircleIcon size={16} /> : item.status === "error" ? <WarningCircleIcon size={16} /> : item.status === "processing" ? <ArrowClockwiseIcon className="fc-spin" size={16} /> : null}
                  {item.status}
                </div>
                {hasOutput(item) ? (
                  <button type="button" aria-label={`Download ${item.outputName}`} onClick={() => downloadBlob(item.output, item.outputName)}><DownloadSimpleIcon size={17} /></button>
                ) : (
                  <button type="button" disabled={busy} aria-label={`Remove ${item.file.name}`} onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}><TrashIcon size={17} /></button>
                )}
              </article>
            ))}
          </div>
        )}
        <footer>
          <div>{message && <span className="fc-error" role="alert">{message}</span>}<span>Files and outputs remain in memory only until this page is cleared or closed.</span></div>
          <button className="fc-primary" type="button" disabled={busy || !items.length} onClick={() => void run()}>{busy ? <ArrowClockwiseIcon className="fc-spin" size={17} /> : null}{busy ? "Converting…" : "Convert"}</button>
          <button type="button" disabled={busy || !completed.length} onClick={() => void downloadAll()}><DownloadSimpleIcon size={17} /> {completed.length > 1 ? "Download ZIP" : "Download"}</button>
        </footer>
      </section>
    </div>
  );
}
