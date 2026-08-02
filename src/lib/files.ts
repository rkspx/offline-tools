import { AppError } from "./errors";

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1_000;
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? units[0];
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export async function readFileText(file: File): Promise<string> {
  try {
    return await file.text();
  } catch (error) {
    throw new AppError("FILE_INVALID", `Could not read ${file.name}.`, {
      cause: error,
      details: { name: file.name, size: file.size, type: file.type },
    });
  }
}

export function fileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(index + 1).toLocaleLowerCase() : "";
}
