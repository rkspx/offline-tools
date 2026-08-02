import { useMemo, useRef, useState } from "react";
import {
  checkContrast,
  contrastRatio,
  dominantColors,
  hexToRgb,
  paletteToCss,
  paletteToJson,
  paletteToTailwind,
  type PaletteColor,
  type RGB,
} from "./engine";
import "./styles.css";

const MAX_CANVAS_EDGE = 420;
const MAX_SAMPLES = 12_000;

type ExportKind = "css" | "tailwind" | "json";

function pixelsFromCanvas(canvas: HTMLCanvasElement): RGB[] {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixelCount = canvas.width * canvas.height;
  const stride = Math.max(1, Math.ceil(pixelCount / MAX_SAMPLES));
  const pixels: RGB[] = [];
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    if ((data[offset + 3] ?? 0) < 180) continue;
    pixels.push([data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0]);
  }
  return pixels;
}

function readableText(hex: string): string {
  const rgb = hexToRgb(hex) ?? [255, 255, 255];
  return contrastRatio(rgb, [0, 0, 0]) >= contrastRatio(rgb, [255, 255, 255])
    ? "#111111"
    : "#FFFFFF";
}

export default function PaletteChecker() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [palette, setPalette] = useState<PaletteColor[]>([]);
  const [clusters, setClusters] = useState(6);
  const [imageName, setImageName] = useState("");
  const [status, setStatus] = useState("Drop in an image to discover its visual language.");
  const [foreground, setForeground] = useState("#111111");
  const [background, setBackground] = useState("#FFFFFF");
  const [exportKind, setExportKind] = useState<ExportKind>("css");
  const [copied, setCopied] = useState(false);
  const [sampledPixels, setSampledPixels] = useState<RGB[]>([]);

  const contrast = useMemo(() => {
    const fg = hexToRgb(foreground) ?? [0, 0, 0];
    const bg = hexToRgb(background) ?? [255, 255, 255];
    return checkContrast(fg, bg);
  }, [foreground, background]);

  const exportValue =
    exportKind === "css"
      ? paletteToCss(palette)
      : exportKind === "tailwind"
        ? paletteToTailwind(palette)
        : paletteToJson(palette);

  async function loadImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Please choose an image file.");
      return;
    }
    setStatus("Reading pixels locally…");
    setImageName(file.name);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = canvasRef.current;
      if (!canvas) {
        bitmap.close();
        return;
      }
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      context?.clearRect(0, 0, width, height);
      context?.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const pixels = pixelsFromCanvas(canvas);
      setSampledPixels(pixels);
      const colors = dominantColors(pixels, clusters);
      setPalette(colors);
      if (colors[0]) setBackground(colors[0].hex);
      if (colors[1]) setForeground(colors[1].hex);
      setStatus(
        colors.length
          ? `Sampled ${pixels.length.toLocaleString()} pixels from ${file.name}.`
          : "No opaque pixels were found in this image.",
      );
    } catch {
      setPalette([]);
      setSampledPixels([]);
      setStatus("This browser could not decode that image.");
    }
  }

  function recluster(next: number) {
    setClusters(next);
    if (!sampledPixels.length) return;
    setStatus("Refining the palette…");
    window.setTimeout(() => {
      setPalette(dominantColors(sampledPixels, next));
      setStatus(`Palette updated to ${next} dominant colors.`);
    }, 0);
  }

  function copyExport() {
    void navigator.clipboard.writeText(exportValue).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="pc-app">
      <section className="pc-hero">
        <div>
          <p className="pc-eyebrow">Image palette checker</p>
          <h2>Turn an image into an accessible color system.</h2>
          <p>Deterministic color extraction and WCAG checks, processed entirely on your device.</p>
        </div>
        <label className="pc-upload">
          <span>Choose image</span>
          <small>PNG, JPEG, WebP, GIF, or any browser-readable image</small>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              void loadImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </section>

      <p className="pc-status" role="status">{status}</p>

      <section className="pc-workspace">
        <div className="pc-image-panel">
          <div className="pc-panel-heading">
            <div>
              <p className="pc-eyebrow">Source</p>
              <h3>{imageName || "Image preview"}</h3>
            </div>
            <label className="pc-cluster-control">
              Colors <output>{clusters}</output>
              <input type="range" min="3" max="10" value={clusters} onChange={(event) => recluster(Number(event.target.value))} />
            </label>
          </div>
          <div className={`pc-canvas-wrap ${imageName ? "has-image" : ""}`}>
            {!imageName && <p>Your image will appear here.</p>}
            <canvas ref={canvasRef} aria-label="Loaded image preview" />
          </div>
        </div>

        <div className="pc-palette-panel">
          <div className="pc-panel-heading">
            <div>
              <p className="pc-eyebrow">Dominant colors</p>
              <h3>Extracted palette</h3>
            </div>
          </div>
          {palette.length ? (
            <div className="pc-swatches">
              {palette.map((color, index) => (
                <div className="pc-swatch" key={`${color.hex}-${index}`} style={{ background: color.hex, color: readableText(color.hex) }}>
                  <button type="button" onClick={() => setForeground(color.hex)} title="Use as foreground">Fg</button>
                  <button type="button" onClick={() => setBackground(color.hex)} title="Use as background">Bg</button>
                  <div>
                    <strong>{color.hex}</strong>
                    <span>{color.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pc-empty-swatches">
              {Array.from({ length: clusters }, (_, index) => <span key={index} />)}
            </div>
          )}
        </div>
      </section>

      <section className="pc-contrast">
        <div className="pc-panel-heading">
          <div>
            <p className="pc-eyebrow">WCAG contrast</p>
            <h3>Test a foreground and background</h3>
          </div>
          <div className="pc-ratio">
            <strong>{contrast.ratio}:1</strong>
            <span>contrast ratio</span>
          </div>
        </div>

        <div className="pc-color-inputs">
          <label>
            Foreground
            <span><input type="color" value={foreground} onChange={(event) => setForeground(event.target.value.toUpperCase())} /><input value={foreground} maxLength={7} onChange={(event) => setForeground(event.target.value.toUpperCase())} /></span>
          </label>
          <button type="button" className="pc-swap" onClick={() => {
            setForeground(background);
            setBackground(foreground);
          }} aria-label="Swap foreground and background">⇄</button>
          <label>
            Background
            <span><input type="color" value={background} onChange={(event) => setBackground(event.target.value.toUpperCase())} /><input value={background} maxLength={7} onChange={(event) => setBackground(event.target.value.toUpperCase())} /></span>
          </label>
        </div>

        <div className="pc-contrast-preview" style={{ color: foreground, background }}>
          <strong>Clear words make confident interfaces.</strong>
          <span>Sample body text at a normal reading size.</span>
        </div>

        <div className="pc-check-grid">
          <Check label="Normal text · AA" pass={contrast.normalAA} threshold="4.5:1" />
          <Check label="Normal text · AAA" pass={contrast.normalAAA} threshold="7:1" />
          <Check label="Large text · AA" pass={contrast.largeAA} threshold="3:1" />
          <Check label="Large text · AAA" pass={contrast.largeAAA} threshold="4.5:1" />
        </div>
      </section>

      <section className="pc-export">
        <div className="pc-panel-heading">
          <div>
            <p className="pc-eyebrow">Handoff</p>
            <h3>Export your palette</h3>
          </div>
          <div className="pc-tabs">
            {(["css", "tailwind", "json"] as const).map((kind) => (
              <button className={exportKind === kind ? "active" : ""} type="button" key={kind} onClick={() => setExportKind(kind)}>
                {kind === "json" ? "JSON / Figma" : kind}
              </button>
            ))}
          </div>
        </div>
        <textarea readOnly rows={12} value={exportValue} aria-label="Generated palette export" />
        <button className="pc-copy" type="button" disabled={!palette.length} onClick={copyExport}>
          {copied ? "Copied" : "Copy export"}
        </button>
      </section>
    </div>
  );
}

function Check({ label, pass, threshold }: { label: string; pass: boolean; threshold: string }) {
  return (
    <div className={pass ? "pc-check pass" : "pc-check fail"}>
      <span aria-hidden>{pass ? "✓" : "×"}</span>
      <div><strong>{label}</strong><small>{pass ? "Passes" : "Needs"} {threshold}</small></div>
    </div>
  );
}
