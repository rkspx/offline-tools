import type { ASRModel, TranscriptSegment } from "browser-whisper";

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
export const MAX_MEDIA_DURATION = 2 * 60 * 60;
export const MAX_RECORDING_DURATION = 30 * 60;

export type EditableSegment = TranscriptSegment & { id: string };
export type ExportFormat = "txt" | "srt" | "vtt" | "json";

export const MODEL_OPTIONS: readonly {
  id: ASRModel;
  name: string;
  size: string;
  detail: string;
}[] = [
  { id: "whisper-tiny_timestamped", name: "Tiny", size: "~64 MB", detail: "Fastest, word timestamps" },
  { id: "whisper-base_timestamped", name: "Base", size: "~136 MB", detail: "Balanced accuracy and speed" },
  { id: "whisper-small_timestamped", name: "Small", size: "~510 MB", detail: "More accurate, slower" },
  { id: "distil-whisper-small", name: "Distil Small", size: "~185 MB", detail: "Fast English-only model" },
] as const;

export function validateMediaFile(file: File): string | undefined {
  if (file.size > MAX_MEDIA_BYTES) return "Files are limited to 500 MB.";
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
    return "Choose a browser-decodable audio or video file.";
  }
  return undefined;
}

export function formatTimestamp(seconds: number, separator: "," | "." = "."): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.floor((safe % 1) * 1000);
  return [hours, minutes, wholeSeconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":") + separator + milliseconds.toString().padStart(3, "0");
}

export function exportTranscript(segments: EditableSegment[], format: ExportFormat): string {
  if (format === "json") {
    return JSON.stringify(segments.map((segment) => ({
      text: segment.text,
      start: segment.start,
      end: segment.end,
      ...(segment.words ? { words: segment.words } : {}),
    })), null, 2);
  }
  if (format === "srt") {
    return segments.map((segment, index) =>
      `${index + 1}\n${formatTimestamp(segment.start, ",")} --> ${formatTimestamp(segment.end, ",")}\n${segment.text.trim()}`,
    ).join("\n\n");
  }
  if (format === "vtt") {
    const cues = segments.map((segment) =>
      `${formatTimestamp(segment.start)} --> ${formatTimestamp(segment.end)}\n${segment.text.trim()}`,
    ).join("\n\n");
    return `WEBVTT\n\n${cues}`;
  }
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n");
}

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before", "being",
  "but", "can", "could", "did", "does", "for", "from", "had", "has", "have", "into",
  "its", "just", "more", "not", "our", "out", "over", "said", "should", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through", "too",
  "very", "was", "were", "what", "when", "where", "which", "while", "who", "will", "with",
  "would", "you", "your",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

export function summarizeExtractively(segments: EditableSegment[], maximum = 5): EditableSegment[] {
  if (segments.length <= maximum) return segments.slice();
  const frequencies = new Map<string, number>();
  for (const segment of segments) {
    for (const word of words(segment.text)) {
      if (word.length < 3 || STOP_WORDS.has(word)) continue;
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }
  }
  const ranked = segments.map((segment, index) => {
    const tokens = words(segment.text).filter((word) => !STOP_WORDS.has(word));
    const score = tokens.reduce((sum, word) => sum + (frequencies.get(word) ?? 0), 0) / Math.max(tokens.length, 1);
    return { segment, index, score };
  });
  return ranked
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maximum)
    .sort((a, b) => a.index - b.index)
    .map(({ segment }) => segment);
}

export function makeSegment(segment: TranscriptSegment, index: number): EditableSegment {
  return { ...segment, id: `${segment.start}-${segment.end}-${index}` };
}
