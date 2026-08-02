import { useEffect, useMemo, useRef, useState } from "react";
import {
  fontNameFromFile,
  generateTypeScale,
  toCssVariables,
  toTokenJson,
} from "./engine";
import "./styles.css";

type LoadedFont = {
  id: string;
  name: string;
  family: string;
  url: string;
  face: FontFace;
};

const DEFAULT_TEXT = "Sphinx of black quartz, judge my vow.";
const SYSTEM_FONT = "system-ui, sans-serif";

function copyText(value: string, onCopied: () => void) {
  void navigator.clipboard.writeText(value).then(onCopied);
}

export default function FontSpecimen() {
  const [fonts, setFonts] = useState<LoadedFont[]>([]);
  const fontsRef = useRef<LoadedFont[]>([]);
  const [displayFamily, setDisplayFamily] = useState(SYSTEM_FONT);
  const [bodyFamily, setBodyFamily] = useState(SYSTEM_FONT);
  const [previewText, setPreviewText] = useState(DEFAULT_TEXT);
  const [size, setSize] = useState(46);
  const [lineHeight, setLineHeight] = useState(1.12);
  const [weight, setWeight] = useState(500);
  const [basePx, setBasePx] = useState(16);
  const [ratio, setRatio] = useState(1.25);
  const [exportKind, setExportKind] = useState<"css" | "json">("css");
  const [status, setStatus] = useState("Choose one or more font files to begin.");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fontsRef.current = fonts;
  }, [fonts]);

  useEffect(
    () => () => {
      for (const font of fontsRef.current) {
        document.fonts.delete(font.face);
        URL.revokeObjectURL(font.url);
      }
    },
    [],
  );

  const scale = useMemo(() => generateTypeScale(basePx, ratio), [basePx, ratio]);
  const exportOptions = {
    family: displayFamily,
    basePx,
    ratio,
    stepsBelow: 2,
    stepsAbove: 6,
  };
  const exportValue =
    exportKind === "css" ? toCssVariables(exportOptions) : toTokenJson(exportOptions);

  async function loadFonts(files: FileList | null) {
    if (!files?.length) return;
    setStatus(`Loading ${files.length} font${files.length === 1 ? "" : "s"}…`);
    const results = await Promise.allSettled(
      Array.from(files).map(async (file, index): Promise<LoadedFont> => {
        const url = URL.createObjectURL(file);
        const name = fontNameFromFile(file.name);
        const family = `minitools-${Date.now()}-${index}-${name.replace(/\W+/g, "-")}`;
        const face = new FontFace(family, `url("${url}")`);
        try {
          await face.load();
          document.fonts.add(face);
          return { id: crypto.randomUUID(), name, family, url, face };
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
      }),
    );
    const loaded = results
      .filter((result): result is PromiseFulfilledResult<LoadedFont> => result.status === "fulfilled")
      .map((result) => result.value);
    const failed = results.length - loaded.length;
    setFonts((current) => [...current, ...loaded]);
    if (loaded[0]) {
      setDisplayFamily(loaded[0].family);
      setBodyFamily((current) => (current === SYSTEM_FONT ? loaded[0]?.family ?? current : current));
    }
    setStatus(
      loaded.length
        ? `${loaded.length} font${loaded.length === 1 ? "" : "s"} ready${failed ? `; ${failed} could not be read` : ""}.`
        : "Those files could not be loaded as browser fonts.",
    );
  }

  function removeFont(font: LoadedFont) {
    document.fonts.delete(font.face);
    URL.revokeObjectURL(font.url);
    setFonts((current) => current.filter((item) => item.id !== font.id));
    if (displayFamily === font.family) setDisplayFamily(SYSTEM_FONT);
    if (bodyFamily === font.family) setBodyFamily(SYSTEM_FONT);
    setStatus(`${font.name} removed.`);
  }

  const fontOptions = (
    <>
      <option value={SYSTEM_FONT}>System sans</option>
      {fonts.map((font) => (
        <option value={font.family} key={font.id}>
          {font.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="fs-app">
      <section className="fs-hero">
        <div>
          <p className="fs-eyebrow">Local font lab</p>
          <h2>Meet your type before it ships.</h2>
          <p>Load local font files, test pairings, and turn a modular scale into reusable tokens.</p>
        </div>
        <label className="fs-upload">
          <span>Load fonts</span>
          <small>WOFF, WOFF2, TTF, or OTF · stays in this browser</small>
          <input
            type="file"
            accept=".woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf"
            multiple
            onChange={(event) => {
              void loadFonts(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </section>

      <p className="fs-status" role="status">{status}</p>

      {fonts.length > 0 && (
        <div className="fs-font-list" aria-label="Loaded fonts">
          {fonts.map((font) => (
            <div className="fs-font-chip" key={font.id}>
              <span style={{ fontFamily: font.family }}>{font.name}</span>
              <button type="button" onClick={() => removeFont(font)} aria-label={`Remove ${font.name}`}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="fs-panel fs-controls" aria-label="Preview controls">
        <label className="fs-wide">
          Preview text
          <input value={previewText} onChange={(event) => setPreviewText(event.target.value)} />
        </label>
        <label>
          Display face
          <select value={displayFamily} onChange={(event) => setDisplayFamily(event.target.value)}>
            {fontOptions}
          </select>
        </label>
        <label>
          Body face
          <select value={bodyFamily} onChange={(event) => setBodyFamily(event.target.value)}>
            {fontOptions}
          </select>
        </label>
        <label>
          Size <output>{size}px</output>
          <input type="range" min="18" max="112" value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </label>
        <label>
          Line height <output>{lineHeight.toFixed(2)}</output>
          <input type="range" min="0.8" max="2" step="0.01" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} />
        </label>
        <label>
          Weight <output>{weight}</output>
          <input type="range" min="100" max="900" step="50" value={weight} onChange={(event) => setWeight(Number(event.target.value))} />
        </label>
      </section>

      <section className="fs-preview" aria-label="Font pairing preview">
        <p className="fs-preview-label">Display sample</p>
        <h3 style={{ fontFamily: displayFamily, fontSize: size, lineHeight, fontWeight: weight }}>
          {previewText || DEFAULT_TEXT}
        </h3>
        <div className="fs-body-sample" style={{ fontFamily: bodyFamily }}>
          <p className="fs-preview-label">Body pairing</p>
          <p>
            Typography gives a product its voice. A useful pairing stays expressive in headlines and
            effortless through longer passages, labels, and small details.
          </p>
        </div>
      </section>

      <section className="fs-scale-section">
        <div className="fs-section-heading">
          <div>
            <p className="fs-eyebrow">Modular scale</p>
            <h3>Build a measured hierarchy</h3>
          </div>
          <div className="fs-inline-fields">
            <label>Base <input type="number" min="8" max="32" value={basePx} onChange={(event) => setBasePx(Number(event.target.value))} /></label>
            <label>Ratio
              <select value={ratio} onChange={(event) => setRatio(Number(event.target.value))}>
                <option value="1.125">Major second · 1.125</option>
                <option value="1.2">Minor third · 1.2</option>
                <option value="1.25">Major third · 1.25</option>
                <option value="1.333">Perfect fourth · 1.333</option>
                <option value="1.5">Perfect fifth · 1.5</option>
                <option value="1.618">Golden ratio · 1.618</option>
              </select>
            </label>
          </div>
        </div>
        <div className="fs-scale-list">
          {scale.map((token) => (
            <div className="fs-scale-row" key={token.name}>
              <code>--text-{token.name}</code>
              <span style={{ fontFamily: displayFamily, fontSize: `${token.sizeRem}rem` }}>Ag</span>
              <output>{token.sizePx}px</output>
            </div>
          ))}
        </div>
      </section>

      <section className="fs-export">
        <div className="fs-section-heading">
          <div>
            <p className="fs-eyebrow">Ready to use</p>
            <h3>Export type tokens</h3>
          </div>
          <div className="fs-segmented">
            <button className={exportKind === "css" ? "active" : ""} type="button" onClick={() => setExportKind("css")}>CSS</button>
            <button className={exportKind === "json" ? "active" : ""} type="button" onClick={() => setExportKind("json")}>JSON / Figma</button>
          </div>
        </div>
        <textarea aria-label="Generated type tokens" readOnly value={exportValue} rows={12} />
        <button className="fs-copy" type="button" onClick={() => copyText(exportValue, () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        })}>
          {copied ? "Copied" : "Copy tokens"}
        </button>
      </section>
    </div>
  );
}
