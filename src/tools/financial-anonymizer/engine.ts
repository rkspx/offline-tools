import Papa from "papaparse";
import { PDFDocument } from "pdf-lib";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const MAX_FINANCIAL_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;

export type FindingKind =
  | "Email"
  | "Phone"
  | "SSN"
  | "Payment card"
  | "IBAN"
  | "Routing number"
  | "Account identifier"
  | "Tax identifier";

export type Box = { x: number; y: number; width: number; height: number };

export type Finding = {
  id: string;
  kind: FindingKind;
  value: string;
  location: string;
  row?: number;
  column?: string;
  page?: number;
  box?: Box;
};

export type CsvDocument = {
  fields: string[];
  rows: Record<string, string>[];
};

type Detector = { kind: FindingKind; regex: RegExp; validate?: (value: string) => boolean };
type DetectedValue = { kind: FindingKind; value: string; start: number; end: number };

function validCard(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const DETECTORS: Detector[] = [
  { kind: "Email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "SSN", regex: /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g },
  { kind: "Payment card", regex: /\b(?:\d[ -]*?){13,19}\b/g, validate: validCard },
  { kind: "IBAN", regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g },
  { kind: "Phone", regex: /(?<!\d)(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]\d{4}(?!\d)/g },
  { kind: "Routing number", regex: /\b(?:routing|aba)\s*(?:number|no\.?|#)?\s*[:=-]?\s*(\d{9})\b/gi },
  { kind: "Account identifier", regex: /\b(?:account|acct)\s*(?:number|no\.?|#)?\s*[:=-]?\s*([A-Z0-9-]{6,24})\b/gi },
  { kind: "Tax identifier", regex: /\b(?:ein|tin|tax id)\s*[:=-]?\s*(\d{2}[- ]?\d{7}|\d{9})\b/gi },
];

export function detectValues(text: string): DetectedValue[] {
  const matches: DetectedValue[] = [];
  for (const detector of DETECTORS) {
    detector.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = detector.regex.exec(text))) {
      const captured = match[1];
      const value = captured ?? match[0];
      const offset = captured ? match[0].indexOf(captured) : 0;
      if (!detector.validate || detector.validate(value)) {
        matches.push({
          kind: detector.kind,
          value,
          start: match.index + offset,
          end: match.index + offset + value.length,
        });
      }
      if (match[0].length === 0) detector.regex.lastIndex += 1;
    }
  }
  return matches
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((item, index, all) => !all.slice(0, index).some((prior) => item.start >= prior.start && item.end <= prior.end));
}

export function parseFinancialCsv(text: string): CsvDocument {
  const parsed = Papa.parse<Record<string, string>>(text, {
    delimiter: ",",
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? "Could not parse CSV.");
  const fields = parsed.meta.fields;
  if (!fields?.length) throw new Error("CSV needs a header row.");
  return { fields, rows: parsed.data };
}

export function findCsvValues(document: CsvDocument): Finding[] {
  const findings: Finding[] = [];
  document.rows.forEach((row, rowIndex) => {
    document.fields.forEach((column) => {
      const text = row[column] ?? "";
      detectValues(text).forEach((match, matchIndex) => findings.push({
        id: `csv-${rowIndex}-${column}-${match.start}-${matchIndex}`,
        kind: match.kind,
        value: match.value,
        location: `Row ${rowIndex + 2}, ${column}`,
        row: rowIndex,
        column,
      }));
    });
  });
  return findings;
}

export function tokenFor(kind: FindingKind, index: number): string {
  return `[${kind.toUpperCase().replace(/\s+/g, "_")}_${String(index + 1).padStart(3, "0")}]`;
}

export function anonymizeCsv(
  document: CsvDocument,
  findings: Finding[],
  selectedIds: ReadonlySet<string>,
  mode: "redact" | "tokenize",
): string {
  const rows = document.rows.map((row) => ({ ...row }));
  let tokenIndex = 0;
  for (const finding of findings) {
    if (!selectedIds.has(finding.id) || finding.row === undefined || !finding.column) continue;
    const targetRow = rows[finding.row];
    if (!targetRow) continue;
    const value = targetRow[finding.column];
    if (value === undefined) continue;
    const replacement = mode === "redact" ? "[REDACTED]" : tokenFor(finding.kind, tokenIndex++);
    targetRow[finding.column] = value.split(finding.value).join(replacement);
  }
  return Papa.unparse(rows, { columns: document.fields, newline: "\r\n" });
}

export async function inspectPdf(bytes: ArrayBuffer): Promise<{ findings: Finding[]; pageCount: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;
  if (document.numPages > MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
  }
  const findings: Finding[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const [itemIndex, item] of content.items.entries()) {
        if (!("str" in item) || !item.str) continue;
        const [, , transformC = 0, transformD = 0, transformX = 0, transformY = 0] =
          pdfjs.Util.transform(viewport.transform, item.transform) as number[];
        const height = Math.max(Math.hypot(transformC, transformD), 4);
        for (const [matchIndex, match] of detectValues(item.str).entries()) {
          const startRatio = match.start / item.str.length;
          const widthRatio = (match.end - match.start) / item.str.length;
          findings.push({
            id: `pdf-${pageNumber}-${itemIndex}-${matchIndex}`,
            kind: match.kind,
            value: match.value,
            location: `Page ${pageNumber}`,
            page: pageNumber,
            box: {
              x: transformX + item.width * startRatio,
              y: transformY - height,
              width: Math.max(item.width * widthRatio, 3),
              height: height * 1.18,
            },
          });
        }
      }
    }
    return { findings, pageCount: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode a PDF page.")), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function permanentlyRedactPdf(
  bytes: ArrayBuffer,
  findings: Finding[],
  selectedIds: ReadonlySet<string>,
  mode: "redact" | "tokenize" = "redact",
  onProgress?: (page: number, total: number) => void,
): Promise<Uint8Array> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const source = await loadingTask.promise;
  if (source.numPages > MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
  }
  const output = await PDFDocument.create();
  const scale = 1.5;
  try {
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      const page = await source.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      if (viewport.width * viewport.height > 18_000_000) throw new Error(`Page ${pageNumber} is too large to rasterize safely.`);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const pageFindings = findings.filter((finding) => finding.page === pageNumber && finding.box && selectedIds.has(finding.id));
      pageFindings.forEach((finding) => {
          const box = finding.box;
          if (!box) return;
          context.fillStyle = "#000";
          context.fillRect(box.x * scale - 2, box.y * scale - 2, box.width * scale + 4, box.height * scale + 4);
          if (mode === "tokenize") {
            const tokenIndex = findings.findIndex((candidate) => candidate.id === finding.id);
            context.save();
            context.beginPath();
            context.rect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
            context.clip();
            context.fillStyle = "#fff";
            context.font = `${Math.max(7, Math.min(11, box.height * scale * 0.7))}px ui-monospace, monospace`;
            context.textBaseline = "middle";
            context.fillText(tokenFor(finding.kind, tokenIndex), box.x * scale, (box.y + box.height / 2) * scale);
            context.restore();
          }
        });
      const image = await output.embedPng(await canvasPng(canvas));
      const outputPage = output.addPage([viewport.width / scale, viewport.height / scale]);
      outputPage.drawImage(image, { x: 0, y: 0, width: outputPage.getWidth(), height: outputPage.getHeight() });
      canvas.width = 1;
      canvas.height = 1;
      onProgress?.(pageNumber, source.numPages);
    }
    return await output.save();
  } finally {
    await loadingTask.destroy();
  }
}
