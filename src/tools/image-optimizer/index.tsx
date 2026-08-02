import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  EyedropperIcon,
  ImageIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import JSZip from "jszip";
import { useEffect, useRef, useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { downloadBlob } from "../../lib/downloads";
import {
  ASSET_PRESETS,
  canvasSupports,
  composeOgImage,
  extensionFor,
  formatBytes,
  optimizeImage,
  savingsPercent,
  type OutputFormat,
  type ResizeMode,
} from "./engine";
import "./styles.css";

type Item = {
  id: number;
  file: File;
  sourceUrl: string;
  status: "queued" | "processing" | "done" | "error";
  output?: Blob;
  outputUrl?: string;
  outputName?: string;
  error?: string;
};

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
  { value: "image/avif", label: "AVIF" },
];

function parseHex(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function rgbHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hasOutput(item: Item): item is Item & { output: Blob; outputName: string } {
  return Boolean(item.output && item.outputName);
}

export default function ImageOptimizer() {
  const [view, setView] = useState<"optimize" | "og">("optimize");
  const [items, setItems] = useState<Item[]>([]);
  const [preset, setPreset] = useState("custom");
  const [width, setWidth] = useState(1600);
  const [height, setHeight] = useState(900);
  const [format, setFormat] = useState<OutputFormat>("image/webp");
  const [quality, setQuality] = useState(82);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("contain");
  const [background, setBackground] = useState("#ffffff");
  const [removeBackground, setRemoveBackground] = useState(false);
  const [removeColor, setRemoveColor] = useState("#ffffff");
  const [tolerance, setTolerance] = useState(28);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ogTitle, setOgTitle] = useState("Build something worth sharing");
  const [ogSubtitle, setOgSubtitle] = useState("A clear message, rendered privately in your browser.");
  const [ogBackground, setOgBackground] = useState("#111827");
  const [ogForeground, setOgForeground] = useState("#f9fafb");
  const [ogAccent, setOgAccent] = useState("#8b5cf6");
  const [ogImage, setOgImage] = useState<File>();
  const [ogOutput, setOgOutput] = useState<{ blob: Blob; url: string }>();
  const [support] = useState<Record<OutputFormat, boolean>>(() =>
    Object.fromEntries(FORMATS.map(({ value }) => [value, canvasSupports(value)])) as Record<OutputFormat, boolean>,
  );
  const nextId = useRef(1);
  const urls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  const trackUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  };

  const releaseUrl = (url: string | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  };

  const addFiles = (files: readonly File[]) => {
    setMessage("");
    const currentBytes = items.reduce((sum, item) => sum + item.file.size, 0);
    let acceptedBytes = currentBytes;
    const added: Item[] = [];
    for (const file of files) {
      const id = nextId.current++;
      if ((!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(file.name)) || file.size > 80 * 1024 * 1024) {
        const sourceUrl = trackUrl(file);
        added.push({ id, file, sourceUrl, status: "error", error: file.size > 80 * 1024 * 1024 ? "Image exceeds the 80 MB per-file limit." : "Unsupported image input." });
      } else if (acceptedBytes + file.size > 250 * 1024 * 1024) {
        setMessage("Some files were skipped because the batch reached the 250 MB in-memory limit.");
      } else {
        acceptedBytes += file.size;
        added.push({ id, file, sourceUrl: trackUrl(file), status: "queued" });
      }
    }
    setItems((current) => [...current, ...added]);
  };

  const choosePreset = (key: string) => {
    const selected = ASSET_PRESETS[key];
    if (!selected) return;
    setPreset(key);
    setWidth(selected.width);
    setHeight(selected.height);
    if (support[selected.format]) setFormat(selected.format);
    setResizeMode(key === "custom" ? "contain" : "cover");
  };

  const updateItem = (id: number, patch: Partial<Item>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const processBatch = async () => {
    const ready = items.filter((item) => item.status !== "error");
    if (!ready.length) {
      setMessage("Add at least one supported image.");
      return;
    }
    if (!support[format]) {
      setMessage(`${format.replace("image/", "").toUpperCase()} encoding is unavailable in this browser.`);
      return;
    }
    setBusy(true);
    setMessage("");
    for (const item of ready) {
      releaseUrl(item.outputUrl);
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { id: candidate.id, file: candidate.file, sourceUrl: candidate.sourceUrl, status: "processing" }
        : candidate));
      try {
        const result = await optimizeImage(item.file, {
          width,
          height,
          quality: quality / 100,
          format,
          mode: resizeMode,
          background,
          ...(removeBackground ? { removeColor: parseHex(removeColor), tolerance } : {}),
        });
        const outputName = `${item.file.name.replace(/\.[^.]+$/, "")}-${width}x${height}.${extensionFor(format)}`;
        updateItem(item.id, { status: "done", output: result.blob, outputUrl: trackUrl(result.blob), outputName });
      } catch (error) {
        updateItem(item.id, { status: "error", error: error instanceof Error ? error.message : "Optimization failed." });
      }
    }
    setBusy(false);
  };

  const sampleColor = (event: React.MouseEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const bounds = image.getBoundingClientRect();
    const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.round((event.clientX - bounds.left) / bounds.width * image.naturalWidth)));
    const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.round((event.clientY - bounds.top) / bounds.height * image.naturalHeight)));
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(x, y, 1, 1).data;
    setRemoveColor(rgbHex(pixel[0] ?? 255, pixel[1] ?? 255, pixel[2] ?? 255));
    setRemoveBackground(true);
  };

  const downloadAll = async () => {
    const done = items.filter(hasOutput);
    if (done.length === 1) {
      const first = done[0];
      if (!first) return;
      downloadBlob(first.output, first.outputName);
      return;
    }
    const zip = new JSZip();
    done.forEach((item) => zip.file(item.outputName, item.output));
    downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }), "optimized-images.zip");
  };

  const buildOg = async () => {
    setBusy(true);
    setMessage("");
    try {
      releaseUrl(ogOutput?.url);
      const blob = await composeOgImage({
        title: ogTitle,
        subtitle: ogSubtitle,
        background: ogBackground,
        foreground: ogForeground,
        accent: ogAccent,
        ...(ogImage ? { image: ogImage } : {}),
      });
      setOgOutput({ blob, url: trackUrl(blob) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not compose the OG image.");
    } finally {
      setBusy(false);
    }
  };

  const clearItems = () => {
    items.forEach((item) => { releaseUrl(item.sourceUrl); releaseUrl(item.outputUrl); });
    setItems([]);
    setMessage("");
  };

  const done = items.filter((item) => item.output);

  return (
    <div className="io-app">
      <div className="io-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "optimize"} className={view === "optimize" ? "is-active" : ""} onClick={() => setView("optimize")}>Batch optimizer</button>
        <button type="button" role="tab" aria-selected={view === "og"} className={view === "og" ? "is-active" : ""} onClick={() => setView("og")}>OG composer</button>
      </div>

      {view === "optimize" ? (
        <>
          <section className="io-workbench">
            <div className="io-drop"><FileDrop accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp" multiple disabled={busy} onFiles={addFiles} /><small>Batch limit 250 MB · 80 MB each · 36 MP output</small></div>
            <div className="io-controls">
              <label>Asset preset
                <select value={preset} disabled={busy} onChange={(event) => choosePreset(event.target.value)}>
                  {Object.entries(ASSET_PRESETS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                </select>
              </label>
              <div className="io-split">
                <label>Width <input type="number" min="1" max="12000" value={width} disabled={busy} onChange={(event) => { setWidth(Number(event.target.value)); setPreset("custom"); }} /></label>
                <label>Height <input type="number" min="1" max="12000" value={height} disabled={busy} onChange={(event) => { setHeight(Number(event.target.value)); setPreset("custom"); }} /></label>
              </div>
              <div className="io-split">
                <label>Fit
                  <select value={resizeMode} disabled={busy} onChange={(event) => setResizeMode(event.target.value as ResizeMode)}>
                    <option value="contain">Contain</option><option value="cover">Cover / crop</option><option value="stretch">Stretch</option>
                  </select>
                </label>
                <label>Output
                  <select value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as OutputFormat)}>
                    {FORMATS.map((item) => <option key={item.value} value={item.value} disabled={!support[item.value]}>{item.label}{support[item.value] ? "" : " (unsupported)"}</option>)}
                  </select>
                </label>
              </div>
              <label>Lossy quality <span>{quality}%</span><input type="range" min="30" max="100" value={quality} disabled={busy || format === "image/png"} onChange={(event) => setQuality(Number(event.target.value))} /></label>
              <label>Canvas background <input type="color" value={background} disabled={busy} onChange={(event) => setBackground(event.target.value)} /></label>
            </div>
          </section>

          <section className="io-removal">
            <div><EyedropperIcon size={19} /><span><strong>Color threshold removal</strong><small>No ML segmentation package is installed. This removes pixels near one sampled color; it is not AI subject detection.</small></span></div>
            <label><input type="checkbox" checked={removeBackground} disabled={busy} onChange={(event) => setRemoveBackground(event.target.checked)} /> Enable</label>
            <label>Color <input type="color" value={removeColor} disabled={!removeBackground || busy} onChange={(event) => setRemoveColor(event.target.value)} /></label>
            <label>Tolerance <input type="range" min="0" max="100" value={tolerance} disabled={!removeBackground || busy} onChange={(event) => setTolerance(Number(event.target.value))} /><span>{tolerance}</span></label>
          </section>

          <section className="io-batch">
            <header><div><strong>Before / after</strong><span>{items.length ? `${items.length} image${items.length === 1 ? "" : "s"} queued` : "Add images to compare size and appearance."}</span></div>{items.length > 0 && <button type="button" disabled={busy} onClick={clearItems}><TrashIcon size={16} /> Clear</button>}</header>
            {!items.length ? <div className="io-empty"><ImageIcon size={32} /> No images selected</div> : (
              <div className="io-grid">
                {items.map((item) => (
                  <article key={item.id}>
                    <div className={`io-preview ${removeBackground ? "is-sampling" : ""}`} title={removeBackground ? "Click to sample a removal color" : undefined}>
                      <img src={item.outputUrl ?? item.sourceUrl} alt="" onClick={removeBackground && !item.outputUrl ? sampleColor : undefined} />
                      {removeBackground && !item.outputUrl && <span><EyedropperIcon size={14} /> Click source to sample</span>}
                    </div>
                    <div className="io-card-body">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <span>{formatBytes(item.file.size)}{item.output ? ` → ${formatBytes(item.output.size)} · ${savingsPercent(item.file.size, item.output.size)}% smaller` : ""}</span>
                      {item.error && <small><WarningCircleIcon size={14} /> {item.error}</small>}
                    </div>
                    <div className={`io-state is-${item.status}`}>{item.status === "done" && <CheckCircleIcon size={15} />}{item.status === "processing" && <ArrowClockwiseIcon className="io-spin" size={15} />}{item.status}</div>
                    <button type="button" disabled={busy} aria-label={`Remove ${item.file.name}`} onClick={() => { releaseUrl(item.sourceUrl); releaseUrl(item.outputUrl); setItems((current) => current.filter((candidate) => candidate.id !== item.id)); }}><TrashIcon size={16} /></button>
                  </article>
                ))}
              </div>
            )}
            <footer><div>{message && <span className="io-error" role="alert">{message}</span>}<span>Animated inputs are flattened. Metadata and color profiles may be discarded during Canvas re-encoding.</span></div><button className="io-primary" type="button" disabled={busy || !items.length} onClick={() => void processBatch()}>{busy ? <ArrowClockwiseIcon className="io-spin" size={17} /> : null}{busy ? "Optimizing…" : "Optimize batch"}</button><button type="button" disabled={busy || !done.length} onClick={() => void downloadAll()}><DownloadSimpleIcon size={17} /> {done.length > 1 ? "ZIP export" : "Download"}</button></footer>
          </section>
        </>
      ) : (
        <section className="io-og">
          <div className="io-og-controls">
            <div><strong>Open Graph canvas</strong><span>Exports a 1200×630 JPEG. Text wraps to three lines.</span></div>
            <label>Title <textarea rows={3} value={ogTitle} maxLength={140} onChange={(event) => setOgTitle(event.target.value)} /></label>
            <label>Subtitle <input value={ogSubtitle} maxLength={120} onChange={(event) => setOgSubtitle(event.target.value)} /></label>
            <div className="io-colors"><label>Background <input type="color" value={ogBackground} onChange={(event) => setOgBackground(event.target.value)} /></label><label>Text <input type="color" value={ogForeground} onChange={(event) => setOgForeground(event.target.value)} /></label><label>Accent <input type="color" value={ogAccent} onChange={(event) => setOgAccent(event.target.value)} /></label></div>
            <label>Backdrop image <input type="file" accept="image/*" onChange={(event) => setOgImage(event.target.files?.[0])} /><small>Optional; rendered as a muted cover image.</small></label>
            <button className="io-primary" type="button" disabled={busy || !ogTitle.trim()} onClick={() => void buildOg()}>{busy ? "Rendering…" : "Render OG image"}</button>
          </div>
          <div className="io-og-preview">
            {ogOutput ? <img src={ogOutput.url} alt="Generated Open Graph preview" /> : <div><ImageIcon size={38} /><span>Render to preview the final 1200×630 image.</span></div>}
            <button type="button" disabled={!ogOutput} onClick={() => ogOutput && downloadBlob(ogOutput.blob, "open-graph.jpg")}><DownloadSimpleIcon size={17} /> Download JPEG</button>
          </div>
        </section>
      )}
    </div>
  );
}
