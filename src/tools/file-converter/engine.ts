import { PDFDocument } from "pdf-lib";

export type ImageOutput = "image/jpeg" | "image/png";
export type FileKind = "image" | "pdf" | "audio" | "unsupported";

export const MAX_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_CANVAS_PIXELS = 40_000_000;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"]);
const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "m4a", "aac", "ogg", "oga", "flac", "webm"]);

export function extension(name: string): string {
  return name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
}

export function stem(name: string): string {
  const ext = extension(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}

export function classifyFile(file: Pick<File, "name" | "type" | "size">): FileKind {
  if (file.size > MAX_FILE_BYTES) return "unsupported";
  const ext = extension(file.name);
  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
  if (file.type.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "unsupported";
}

export function isHeic(file: Pick<File, "name" | "type">): boolean {
  return /image\/hei[cf]/i.test(file.type) || /^hei[cf]$/i.test(extension(file.name));
}

export function unsupportedReason(file: Pick<File, "name" | "type" | "size">): string | null {
  if (file.size > MAX_FILE_BYTES) return "File exceeds the 150 MB per-file safety limit.";
  if (classifyFile(file) === "unsupported") {
    return "Unsupported input. This tool handles browser-decodable images, HEIC/HEIF, PDF, and browser-decodable audio only.";
  }
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, type: ImageOutput, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error(`This browser could not encode ${type === "image/jpeg" ? "JPEG" : "PNG"}.`)),
      type,
      quality,
    );
  });
}

async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ("createImageBitmap" in globalThis) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
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

export async function convertImage(file: File, output: ImageOutput, quality = 0.9): Promise<Blob> {
  let source: Blob = file;
  if (isHeic(file)) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: output, quality });
    source = Array.isArray(converted) ? converted[0] ?? file : converted;
    if (source === file) throw new Error("The HEIC file did not contain a decodable still image.");
  }
  const decoded = await decodeImage(source);
  try {
    if (decoded.width * decoded.height > MAX_CANVAS_PIXELS) {
      throw new Error("Image exceeds the 40 megapixel canvas safety limit.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");
    if (output === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(decoded.source, 0, 0);
    return await canvasBlob(canvas, output, quality);
  } finally {
    decoded.close();
  }
}

export async function imagesToPdf(files: readonly File[]): Promise<Blob> {
  if (!files.length) throw new Error("Add at least one image.");
  const document = await PDFDocument.create();
  for (const file of files) {
    const jpeg = await convertImage(file, "image/jpeg", 0.94);
    const embedded = await document.embedJpg(await jpeg.arrayBuffer());
    const page = document.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  return new Blob([new Uint8Array(await document.save())], { type: "application/pdf" });
}

export async function mergePdfs(files: readonly File[]): Promise<Blob> {
  if (files.length < 2) throw new Error("Add at least two PDF files to merge.");
  const output = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return new Blob([new Uint8Array(await output.save())], { type: "application/pdf" });
}

export async function splitPdf(file: File): Promise<Blob[]> {
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  const outputs: Blob[] = [];
  for (const index of source.getPageIndices()) {
    const document = await PDFDocument.create();
    const [page] = await document.copyPages(source, [index]);
    if (page) document.addPage(page);
    outputs.push(new Blob([new Uint8Array(await document.save())], { type: "application/pdf" }));
  }
  return outputs;
}

export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  if (!channelCount || !frameCount || channels.some((channel) => channel.length !== frameCount)) {
    throw new Error("Decoded audio has invalid channel data.");
  }
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function audioToWav(file: File): Promise<Blob> {
  const AudioContextClass = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioContextClass) throw new Error("Web Audio decoding is unavailable in this browser.");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return encodeWav(channels, decoded.sampleRate);
  } catch (error) {
    throw new Error(`This browser cannot decode ${file.name}. Web Audio support varies by browser and codec.`, { cause: error });
  } finally {
    await context.close();
  }
}
