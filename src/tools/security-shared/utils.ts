import JSZip from "jszip";

export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 250;
export const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;

export type ArchiveEntry = { name: string; bytes: Uint8Array };

export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexPreview(bytes: Uint8Array, limit = 512): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(47);
    const text = [...chunk].map((byte) => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".").join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  ${text}`);
  }
  return lines.join("\n");
}

export function textPreview(bytes: Uint8Array, limit = 4000): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, limit)).replace(/\u0000/g, "·");
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function download(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readBoundedZip(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Archive exceeds the 20 MB compressed limit.");
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const files = Object.values(archive.files).filter((entry) => !entry.dir);
  if (files.length > MAX_ARCHIVE_FILES) throw new Error(`Archive exceeds the ${MAX_ARCHIVE_FILES}-file limit.`);
  const result: ArchiveEntry[] = [];
  let expanded = 0;
  for (const file of files) {
    const data = await file.async("uint8array");
    expanded += data.byteLength;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("Archive exceeds the 40 MB expanded-data limit.");
    result.push({ name: file.name, bytes: data });
  }
  return result;
}

export function jsonReport(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
