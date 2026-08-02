import bwipjs from "bwip-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Papa from "papaparse";
import * as QRCode from "qrcode";

export type BarcodeFormat = "qrcode" | "code128" | "code39" | "ean13" | "ean8" | "upca" | "interleaved2of5";

export type SourceRow = Record<string, string>;

export type FieldMapping = {
  sku: string;
  name: string;
  value: string;
};

export type LabelRecord = {
  sku: string;
  name: string;
  value: string;
  sourceIndex: number;
};

export type SheetSettings = {
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  gapXMm: number;
  gapYMm: number;
  innerMarginMm: number;
};

export type LabelPosition = {
  page: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

export const DEFAULT_SHEET: SheetSettings = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginTopMm: 12,
  marginRightMm: 12,
  marginBottomMm: 12,
  marginLeftMm: 12,
  labelWidthMm: 60,
  labelHeightMm: 35,
  gapXMm: 3,
  gapYMm: 3,
  innerMarginMm: 3,
};

export const FORMAT_LABELS: Record<BarcodeFormat, string> = {
  qrcode: "QR Code",
  code128: "Code 128",
  code39: "Code 39",
  ean13: "EAN-13",
  ean8: "EAN-8",
  upca: "UPC-A",
  interleaved2of5: "Interleaved 2 of 5",
};

export function parseCsv(text: string): SourceRow[] {
  const result = Papa.parse<SourceRow>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  if (result.errors.length) throw new Error(result.errors[0]?.message ?? "Could not parse CSV.");
  if (!result.meta.fields?.length) throw new Error("CSV needs a header row.");
  return result.data;
}

export function mapRows(rows: SourceRow[], mapping: FieldMapping): LabelRecord[] {
  return rows.map((row, sourceIndex) => ({
    sku: mapping.sku ? row[mapping.sku]?.trim() ?? "" : "",
    name: mapping.name ? row[mapping.name]?.trim() ?? "" : "",
    value: row[mapping.value]?.trim() ?? "",
    sourceIndex,
  }));
}

export function validateBarcode(value: string, format: BarcodeFormat): string | null {
  if (!value) return "Value is empty.";
  if (format === "qrcode") return value.length > 2953 ? "QR value is too long." : null;
  if (format === "code128") return /[^\x20-\x7E]/.test(value) ? "Code 128 accepts printable ASCII in this tool." : null;
  if (format === "code39") return /^[0-9A-Z .$/+%-]+$/.test(value) ? null : "Code 39 accepts uppercase letters, digits, space, and . $ / + % -.";
  if (format === "ean13") return /^\d{12,13}$/.test(value) ? null : "EAN-13 needs 12 or 13 digits.";
  if (format === "ean8") return /^\d{7,8}$/.test(value) ? null : "EAN-8 needs 7 or 8 digits.";
  if (format === "upca") return /^\d{11,12}$/.test(value) ? null : "UPC-A needs 11 or 12 digits.";
  if (!/^\d+$/.test(value)) return "Interleaved 2 of 5 needs digits only.";
  return value.length % 2 === 0 ? null : "Interleaved 2 of 5 needs an even number of digits.";
}

export function validateSheet(settings: SheetSettings): string[] {
  const errors: string[] = [];
  const values = Object.values(settings);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) errors.push("All measurements must be zero or positive.");
  if (settings.labelWidthMm <= 0 || settings.labelHeightMm <= 0) errors.push("Label width and height must be greater than zero.");
  const usableWidth = settings.pageWidthMm - settings.marginLeftMm - settings.marginRightMm;
  const usableHeight = settings.pageHeightMm - settings.marginTopMm - settings.marginBottomMm;
  if (usableWidth < settings.labelWidthMm || usableHeight < settings.labelHeightMm) errors.push("At least one label must fit inside the sheet margins.");
  if (settings.innerMarginMm * 2 >= Math.min(settings.labelWidthMm, settings.labelHeightMm)) errors.push("The label inner margin is too large.");
  return errors;
}

export function sheetCapacity(settings: SheetSettings): { columns: number; rows: number; perPage: number } {
  const columns = Math.max(0, Math.floor((settings.pageWidthMm - settings.marginLeftMm - settings.marginRightMm + settings.gapXMm) / (settings.labelWidthMm + settings.gapXMm)));
  const rows = Math.max(0, Math.floor((settings.pageHeightMm - settings.marginTopMm - settings.marginBottomMm + settings.gapYMm) / (settings.labelHeightMm + settings.gapYMm)));
  return { columns, rows, perPage: columns * rows };
}

export function layoutLabels(count: number, settings: SheetSettings): LabelPosition[] {
  const capacity = sheetCapacity(settings);
  if (!capacity.perPage) return [];
  return Array.from({ length: count }, (_, index) => {
    const slot = index % capacity.perPage;
    const column = slot % capacity.columns;
    const row = Math.floor(slot / capacity.columns);
    return {
      page: Math.floor(index / capacity.perPage),
      xMm: settings.marginLeftMm + column * (settings.labelWidthMm + settings.gapXMm),
      yMm: settings.marginTopMm + row * (settings.labelHeightMm + settings.gapYMm),
      widthMm: settings.labelWidthMm,
      heightMm: settings.labelHeightMm,
    };
  });
}

export async function barcodeDataUrl(value: string, format: BarcodeFormat, width = 480, height = 220): Promise<string> {
  if (format === "qrcode") {
    return QRCode.toDataURL(value, { width: Math.min(width, height), margin: 1, errorCorrectionLevel: "M" });
  }
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, {
    bcid: format,
    text: value,
    scale: 3,
    height: Math.max(8, height / 12),
    width: Math.max(24, width / 12),
    includetext: false,
    backgroundcolor: "FFFFFF",
    paddingwidth: 4,
    paddingheight: 4,
  });
  return canvas.toDataURL("image/png");
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.split(",")[1] ?? "";
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const mmToPoints = (value: number) => value * 72 / 25.4;

export async function makeLabelPdf(labels: LabelRecord[], format: BarcodeFormat, settings: SheetSettings): Promise<Uint8Array> {
  const sheetErrors = validateSheet(settings);
  if (sheetErrors.length) throw new Error(sheetErrors[0]);
  const valid = labels.filter((label) => !validateBarcode(label.value, format));
  if (!valid.length) throw new Error("There are no valid labels to export.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const positions = layoutLabels(valid.length, settings);
  const pages = Array.from({ length: (positions.at(-1)?.page ?? 0) + 1 }, () =>
    pdf.addPage([mmToPoints(settings.pageWidthMm), mmToPoints(settings.pageHeightMm)]),
  );

  for (let index = 0; index < valid.length; index += 1) {
    const label = valid[index];
    const position = positions[index];
    if (!label || !position) continue;
    const page = pages[position.page];
    if (!page) continue;
    const image = await pdf.embedPng(dataUrlBytes(await barcodeDataUrl(label.value, format)));
    const x = mmToPoints(position.xMm + settings.innerMarginMm);
    const top = mmToPoints(settings.pageHeightMm - position.yMm - settings.innerMarginMm);
    const width = mmToPoints(position.widthMm - settings.innerMarginMm * 2);
    const height = mmToPoints(position.heightMm - settings.innerMarginMm * 2);
    const textHeight = Math.min(22, height * 0.27);
    const imageBoxHeight = height - textHeight;
    const scale = Math.min(width / image.width, imageBoxHeight / image.height);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    page.drawImage(image, {
      x: x + (width - imageWidth) / 2,
      y: top - imageHeight,
      width: imageWidth,
      height: imageHeight,
    });
    const name = label.name.slice(0, 48);
    const sku = label.sku.slice(0, 48);
    page.drawText(name || label.value.slice(0, 48), { x, y: top - imageBoxHeight - 9, size: 8, font: bold, color: rgb(0.08, 0.09, 0.1), maxWidth: width });
    if (sku) page.drawText(sku, { x, y: top - imageBoxHeight - 19, size: 7, font, color: rgb(0.3, 0.31, 0.33), maxWidth: width });
  }
  return pdf.save();
}
