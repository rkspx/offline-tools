import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  PrinterIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "../../lib/downloads";
import {
  barcodeDataUrl,
  DEFAULT_SHEET,
  FORMAT_LABELS,
  makeLabelPdf,
  mapRows,
  parseCsv,
  sheetCapacity,
  validateBarcode,
  validateSheet,
  type BarcodeFormat,
  type FieldMapping,
  type SheetSettings,
  type SourceRow,
} from "./engine";
import "./styles.css";

const SAMPLE = `sku,name,value
MUG-RD,Red studio mug,https://shop.example/products/mug-red
BOWL-BL,Blue breakfast bowl,https://shop.example/products/bowl-blue
VASE-SM,Small stem vase,https://shop.example/products/vase-small`;

type PreviewImage = { index: number; url: string };

export default function BarcodeLabeler() {
  const [rows, setRows] = useState<SourceRow[]>(() => parseCsv(SAMPLE));
  const [fileName, setFileName] = useState("Sample labels");
  const [mapping, setMapping] = useState<FieldMapping>({ sku: "sku", name: "name", value: "value" });
  const [format, setFormat] = useState<BarcodeFormat>("qrcode");
  const [settings, setSettings] = useState<SheetSettings>(DEFAULT_SHEET);
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);
  const [status, setStatus] = useState("Sample rows are ready.");
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const columns = Object.keys(rows[0] ?? {});
  const labels = useMemo(() => mapRows(rows, mapping), [mapping, rows]);
  const labelErrors = useMemo(() => labels.map((label) => validateBarcode(label.value, format)), [format, labels]);
  const invalidCount = labelErrors.filter(Boolean).length;
  const geometryErrors = validateSheet(settings);
  const capacity = sheetCapacity(settings);
  const validCount = labels.length - invalidCount;
  const pageCount = capacity.perPage ? Math.ceil(validCount / capacity.perPage) : 0;

  useEffect(() => {
    let cancelled = false;
    void Promise.all(labels.slice(0, 12).map(async (label, index) => {
      if (labelErrors[index]) return null;
      try {
        return { index, url: await barcodeDataUrl(label.value, format, 300, 150) };
      } catch {
        return null;
      }
    })).then((images) => {
      if (!cancelled) setPreviewImages(images.filter((image): image is PreviewImage => image !== null));
    });
    return () => { cancelled = true; };
  }, [format, labelErrors, labels]);

  async function loadCsv(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      const nextColumns = Object.keys(parsed[0] ?? {});
      setRows(parsed);
      setFileName(file.name);
      setMapping({
        sku: nextColumns.find((column) => /sku|code|id/i.test(column)) ?? nextColumns[0] ?? "",
        name: nextColumns.find((column) => /name|title|product/i.test(column)) ?? nextColumns[1] ?? "",
        value: nextColumns.find((column) => /value|url|barcode|sku|code/i.test(column)) ?? nextColumns[0] ?? "",
      });
      setStatus(`${parsed.length} rows loaded locally.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not read that CSV.");
    }
  }

  function updateSetting(key: keyof SheetSettings, raw: string) {
    setSettings((current) => ({ ...current, [key]: Number(raw) }));
  }

  function setPagePreset(value: string) {
    if (value === "letter") setSettings((current) => ({ ...current, pageWidthMm: 215.9, pageHeightMm: 279.4 }));
    if (value === "a4") setSettings((current) => ({ ...current, pageWidthMm: 210, pageHeightMm: 297 }));
  }

  async function downloadPdf() {
    setExporting(true);
    setStatus("Rendering barcodes and building the PDF locally.");
    try {
      const bytes = await makeLabelPdf(labels, format, settings);
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), "barcode-labels.pdf");
      setStatus(`Downloaded ${validCount} labels across ${pageCount} page${pageCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create the PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="bl-app">
      <section className="bl-toolbar">
        <div><strong>{fileName}</strong><span>{status}</span></div>
        <button type="button" onClick={() => fileInput.current?.click()}><FileArrowUpIcon aria-hidden size={17} /> Import CSV</button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            void loadCsv(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>

      <div className="bl-workspace">
        <aside className="bl-controls">
          <section>
            <header><strong>Data mapping</strong><span>{rows.length} source rows</span></header>
            {(["sku", "name", "value"] as const).map((field) => (
              <label key={field}>
                {field === "sku" ? "SKU" : field === "name" ? "Product name" : "Encoded value"}
                <select value={mapping[field]} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}>
                  {field !== "value" && <option value="">Do not print</option>}
                  {columns.map((column) => <option key={column}>{column}</option>)}
                </select>
              </label>
            ))}
            <label>
              Barcode format
              <select value={format} onChange={(event) => setFormat(event.target.value as BarcodeFormat)}>
                {Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </section>

          <section>
            <header><strong>Sheet</strong><span>Millimeters</span></header>
            <label>
              Page preset
              <select defaultValue="a4" onChange={(event) => setPagePreset(event.target.value)}>
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <div className="bl-pair">
              <Measure label="Page width" value={settings.pageWidthMm} onChange={(value) => updateSetting("pageWidthMm", value)} />
              <Measure label="Page height" value={settings.pageHeightMm} onChange={(value) => updateSetting("pageHeightMm", value)} />
            </div>
            <div className="bl-pair">
              <Measure label="Label width" value={settings.labelWidthMm} onChange={(value) => updateSetting("labelWidthMm", value)} />
              <Measure label="Label height" value={settings.labelHeightMm} onChange={(value) => updateSetting("labelHeightMm", value)} />
            </div>
            <div className="bl-pair">
              <Measure label="Gap X" value={settings.gapXMm} onChange={(value) => updateSetting("gapXMm", value)} />
              <Measure label="Gap Y" value={settings.gapYMm} onChange={(value) => updateSetting("gapYMm", value)} />
            </div>
          </section>

          <section>
            <header><strong>Margins</strong><span>Sheet and label inset</span></header>
            <div className="bl-pair">
              <Measure label="Top" value={settings.marginTopMm} onChange={(value) => updateSetting("marginTopMm", value)} />
              <Measure label="Right" value={settings.marginRightMm} onChange={(value) => updateSetting("marginRightMm", value)} />
              <Measure label="Bottom" value={settings.marginBottomMm} onChange={(value) => updateSetting("marginBottomMm", value)} />
              <Measure label="Left" value={settings.marginLeftMm} onChange={(value) => updateSetting("marginLeftMm", value)} />
            </div>
            <Measure label="Inside each label" value={settings.innerMarginMm} onChange={(value) => updateSetting("innerMarginMm", value)} />
          </section>
        </aside>

        <main className="bl-main">
          <section className="bl-summary">
            <div><strong>{validCount}</strong><span>valid labels</span></div>
            <div><strong>{capacity.columns} × {capacity.rows}</strong><span>labels per sheet</span></div>
            <div><strong>{pageCount}</strong><span>PDF pages</span></div>
            <button type="button" disabled={exporting || !validCount || geometryErrors.length > 0} onClick={() => void downloadPdf()}>
              {exporting ? <PrinterIcon aria-hidden size={18} /> : <DownloadSimpleIcon aria-hidden size={18} />}
              {exporting ? "Building PDF" : "Download PDF"}
            </button>
          </section>

          {(invalidCount > 0 || geometryErrors.length > 0) && (
            <section className="bl-errors" role="alert">
              <WarningCircleIcon aria-hidden size={19} />
              <div>
                <strong>{geometryErrors[0] ?? `${invalidCount} row${invalidCount === 1 ? "" : "s"} cannot be encoded as ${FORMAT_LABELS[format]}.`}</strong>
                <span>Invalid rows are excluded from the PDF. Review the row list below.</span>
              </div>
            </section>
          )}

          <section className="bl-preview">
            <header><div><strong>Live sheet preview</strong><span>First {Math.min(labels.length, 12)} labels. Print geometry is preserved in the PDF.</span></div></header>
            <div className="bl-sheet" style={{
              aspectRatio: `${settings.pageWidthMm} / ${settings.pageHeightMm}`,
              gridTemplateColumns: `repeat(${Math.max(1, capacity.columns)}, minmax(0, 1fr))`,
              gap: `${Math.max(2, settings.gapXMm / Math.max(settings.labelWidthMm, 1) * 100)}%`,
              padding: `${Math.max(2, settings.marginTopMm / Math.max(settings.pageHeightMm, 1) * 100)}% ${Math.max(2, settings.marginRightMm / Math.max(settings.pageWidthMm, 1) * 100)}%`,
            }}>
              {labels.slice(0, 12).map((label, index) => {
                const image = previewImages.find((item) => item.index === index);
                const error = labelErrors[index];
                return (
                  <article className={`bl-label ${error ? "invalid" : ""}`} key={`${label.sourceIndex}-${label.value}`}>
                    {image ? <img src={image.url} alt={`${FORMAT_LABELS[format]} for ${label.value}`} /> : <div className="bl-image-placeholder">{error ? "Invalid" : "Rendering"}</div>}
                    <strong>{label.name || label.value}</strong>
                    {label.sku && <span>{label.sku}</span>}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="bl-rows">
            <header><div><strong>Validation</strong><span>Every imported row</span></div></header>
            <div className="bl-row-list">
              {labels.map((label, index) => (
                <div className={labelErrors[index] ? "is-invalid" : ""} key={`${label.sourceIndex}-${index}`}>
                  <span>{index + 1}</span>
                  <strong>{label.sku || "No SKU"}</strong>
                  <span>{label.name || "No product name"}</span>
                  <code>{label.value || "Empty value"}</code>
                  <small>{labelErrors[index] ?? "Ready"}</small>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function Measure({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <label>{label}<input type="number" min="0" step="0.5" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
