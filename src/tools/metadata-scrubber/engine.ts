import * as exifr from "exifr";

export type OutputFormat = "preserve" | "image/jpeg" | "image/png" | "image/webp";

export type MetadataReport = {
  entries: { key: string; value: string }[];
  latitude?: number;
  longitude?: number;
  orientation?: number;
  error?: string;
};

export type ScrubResult = {
  blob: Blob;
  width: number;
  height: number;
  mime: Exclude<OutputFormat, "preserve">;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function fileExtension(name: string): string {
  return name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
}

export function baseName(name: string): string {
  const extension = fileExtension(name);
  return extension ? name.slice(0, -(extension.length + 1)) : name;
}

export function inputMime(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type;
  return MIME_BY_EXTENSION[fileExtension(file.name)] ?? "";
}

export function isHeic(file: Pick<File, "name" | "type">): boolean {
  return /image\/hei[cf]/i.test(file.type) || /^hei[cf]$/i.test(fileExtension(file.name));
}

function printable(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return String(value);
  if (Array.isArray(value)) {
    const values = value.map(printable).filter((item): item is string => Boolean(item));
    return values.length ? values.join(", ") : null;
  }
  return null;
}

export function normalizeMetadata(raw: Record<string, unknown> | undefined): MetadataReport {
  if (!raw) return { entries: [] };
  const entries = Object.entries(raw)
    .map(([key, value]) => ({ key, value: printable(value) }))
    .filter((entry): entry is { key: string; value: string } => entry.value !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
  const latitude = typeof raw.latitude === "number" ? raw.latitude : undefined;
  const longitude = typeof raw.longitude === "number" ? raw.longitude : undefined;
  const orientation = typeof raw.Orientation === "number" ? raw.Orientation : undefined;
  return {
    entries,
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    ...(orientation === undefined ? {} : { orientation }),
  };
}

export async function readMetadata(file: File): Promise<MetadataReport> {
  try {
    const raw = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      interop: true,
      ifd1: false,
      iptc: true,
      icc: true,
      xmp: true,
      translateValues: true,
      reviveValues: true,
      mergeOutput: true,
    }) as Record<string, unknown> | undefined;
    return normalizeMetadata(raw);
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error.message : "Metadata could not be read.",
    };
  }
}

export function canvasSupports(mime: string): boolean {
  if (typeof document === "undefined") return mime === "image/jpeg" || mime === "image/png";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  return canvas.toDataURL(mime).startsWith(`data:${mime}`);
}

export function resolveOutputMime(
  file: Pick<File, "name" | "type">,
  selected: OutputFormat,
  supports: (mime: string) => boolean = canvasSupports,
): Exclude<OutputFormat, "preserve"> {
  if (selected !== "preserve") {
    if (!supports(selected)) throw new Error(`${selected.replace("image/", "").toUpperCase()} encoding is not supported by this browser.`);
    return selected;
  }
  const original = inputMime(file);
  if ((original === "image/jpeg" || original === "image/png" || original === "image/webp") && supports(original)) {
    return original;
  }
  return "image/png";
}

export function renderFilename(
  template: string,
  file: Pick<File, "name">,
  index: number,
  mime: Exclude<OutputFormat, "preserve">,
  date = new Date(),
): string {
  const extension = EXTENSION_BY_MIME[mime];
  const values: Record<string, string> = {
    name: baseName(file.name),
    ext: extension ?? "bin",
    index: String(index + 1).padStart(3, "0"),
    date: date.toISOString().slice(0, 10),
  };
  let output = template.replace(/\{(name|ext|index|date)\}/g, (_, key: string) => values[key] ?? "");
  output = output.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  if (!output) output = `image-${values.index}`;
  if (!output.toLowerCase().endsWith(`.${extension}`)) output = `${output}.${extension}`;
  return output;
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (isHeic(file)) {
    throw new Error("HEIC/HEIF decoding is not supported. Convert the file to JPEG, PNG, or WebP first.");
  }
  if ("createImageBitmap" in globalThis) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This browser could not decode the image."));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error(`Could not encode ${mime.replace("image/", "").toUpperCase()}.`)),
      mime,
      quality,
    );
  });
}

export async function scrubImage(file: File, format: OutputFormat, quality = 0.92): Promise<ScrubResult> {
  const mime = resolveOutputMime(file, format);
  const decoded = await decodeImage(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");
    if (mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, mime, quality);
    return { blob, width: canvas.width, height: canvas.height, mime };
  } finally {
    decoded.close();
  }
}
