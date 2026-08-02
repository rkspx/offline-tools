export type OutputFormat = "image/jpeg" | "image/png" | "image/webp" | "image/avif";
export type ResizeMode = "contain" | "cover" | "stretch";

export type AssetPreset = {
  label: string;
  width: number;
  height: number;
  format: OutputFormat;
};

export type OptimizeOptions = {
  width: number;
  height: number;
  quality: number;
  format: OutputFormat;
  mode: ResizeMode;
  background: string;
  removeColor?: readonly [number, number, number];
  tolerance?: number;
};

export type OptimizeResult = {
  blob: Blob;
  width: number;
  height: number;
};

export const MAX_INPUT_BYTES = 80 * 1024 * 1024;
export const MAX_OUTPUT_PIXELS = 36_000_000;

export const ASSET_PRESETS: Record<string, AssetPreset> = {
  custom: { label: "Custom", width: 1600, height: 900, format: "image/webp" },
  favicon16: { label: "Favicon · 16×16", width: 16, height: 16, format: "image/png" },
  favicon32: { label: "Favicon · 32×32", width: 32, height: 32, format: "image/png" },
  favicon180: { label: "Apple touch · 180×180", width: 180, height: 180, format: "image/png" },
  og: { label: "Open Graph · 1200×630", width: 1200, height: 630, format: "image/jpeg" },
  socialSquare: { label: "Social square · 1080×1080", width: 1080, height: 1080, format: "image/jpeg" },
  socialPortrait: { label: "Social portrait · 1080×1350", width: 1080, height: 1350, format: "image/jpeg" },
  xHeader: { label: "X header · 1500×500", width: 1500, height: 500, format: "image/jpeg" },
};

export function extensionFor(format: OutputFormat): string {
  if (format === "image/jpeg") return "jpg";
  return format.replace("image/", "");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export function savingsPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round((1 - after / before) * 100);
}

export function fitDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
  allowUpscale = false,
): { width: number; height: number } {
  if ([sourceWidth, sourceHeight, maxWidth, maxHeight].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Image dimensions must be positive numbers.");
  }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, allowUpscale ? Number.POSITIVE_INFINITY : 1);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

export function applyColorThreshold(
  pixels: Uint8ClampedArray,
  target: readonly [number, number, number],
  tolerance: number,
): number {
  const threshold = Math.max(0, Math.min(255, tolerance)) ** 2;
  let removed = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const distance = (red - target[0]) ** 2
      + (green - target[1]) ** 2
      + (blue - target[2]) ** 2;
    if (distance <= threshold) {
      pixels[index + 3] = 0;
      removed += 1;
    }
  }
  return removed;
}

export function canvasSupports(format: OutputFormat): boolean {
  if (typeof document === "undefined") return format === "image/jpeg" || format === "image/png";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  return canvas.toDataURL(format).startsWith(`data:${format}`);
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This browser cannot decode this image."));
      element.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function toBlob(canvas: HTMLCanvasElement, format: OutputFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob?.type === format
        ? resolve(blob)
        : reject(new Error(`${format.replace("image/", "").toUpperCase()} output is not supported by this browser.`)),
      format,
      quality,
    );
  });
}

function drawFitted(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mode: ResizeMode,
): void {
  if (mode === "stretch") {
    context.drawImage(source, 0, 0, width, height);
    return;
  }
  const scale = mode === "cover"
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export async function optimizeImage(file: File, options: OptimizeOptions): Promise<OptimizeResult> {
  if (file.size > MAX_INPUT_BYTES) throw new Error("Image exceeds the 80 MB input safety limit.");
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  if (width * height > MAX_OUTPUT_PIXELS) throw new Error("Output exceeds the 36 megapixel safety limit.");
  if (!canvasSupports(options.format)) throw new Error(`${options.format.replace("image/", "").toUpperCase()} output is not supported by this browser.`);
  const decoded = await decodeImage(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: Boolean(options.removeColor) });
    if (!context) throw new Error("Canvas 2D is unavailable.");
    if (options.format === "image/jpeg" || !options.removeColor) {
      context.fillStyle = options.background;
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    drawFitted(context, decoded.source, decoded.width, decoded.height, width, height, options.mode);
    if (options.removeColor) {
      const data = context.getImageData(0, 0, width, height);
      applyColorThreshold(data.data, options.removeColor, options.tolerance ?? 30);
      context.putImageData(data, 0, 0);
      if (options.format === "image/jpeg") {
        throw new Error("Background removal needs PNG, WebP, or AVIF output because JPEG has no transparency.");
      }
    }
    return { blob: await toBlob(canvas, options.format, options.quality), width, height };
  } finally {
    decoded.close();
  }
}

export type OgOptions = {
  title: string;
  subtitle: string;
  background: string;
  foreground: string;
  accent: string;
  image?: File;
};

export async function composeOgImage(options: OgOptions): Promise<Blob> {
  const width = 1200;
  const height = 630;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  context.fillStyle = options.background;
  context.fillRect(0, 0, width, height);
  let decoded: Awaited<ReturnType<typeof decodeImage>> | undefined;
  try {
    if (options.image) {
      decoded = await decodeImage(options.image);
      context.globalAlpha = 0.32;
      drawFitted(context, decoded.source, decoded.width, decoded.height, width, height, "cover");
      context.globalAlpha = 1;
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, options.background);
      gradient.addColorStop(0.72, `${options.background}CC`);
      gradient.addColorStop(1, `${options.background}33`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
    context.fillStyle = options.accent;
    context.fillRect(72, 80, 92, 8);
    context.fillStyle = options.foreground;
    context.font = "700 68px system-ui, sans-serif";
    context.textBaseline = "top";
    const words = options.title.trim().split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > 900 && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((value, index) => context.fillText(value, 72, 124 + index * 82));
    context.globalAlpha = 0.78;
    context.font = "400 30px system-ui, sans-serif";
    context.fillText(options.subtitle.slice(0, 120), 76, 500);
    context.globalAlpha = 1;
    return await toBlob(canvas, "image/jpeg", 0.92);
  } finally {
    decoded?.close();
  }
}
