import { describe, expect, it } from "vitest";
import {
  exportTranscript,
  formatTimestamp,
  makeSegment,
  summarizeExtractively,
  validateMediaFile,
} from "./engine";

const segments = [
  makeSegment({ start: 0, end: 2.25, text: "The local model downloads once." }, 0),
  makeSegment({ start: 2.25, end: 5, text: "The local model stays in browser storage." }, 1),
  makeSegment({ start: 5, end: 8, text: "Audio remains on this device." }, 2),
];

describe("offline transcriber engine", () => {
  it("validates media type and size", () => {
    expect(validateMediaFile(new File(["x"], "voice.wav", { type: "audio/wav" }))).toBeUndefined();
    expect(validateMediaFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toContain("audio or video");
  });

  it("formats timestamps without rounding into the next cue", () => {
    expect(formatTimestamp(3661.9999)).toBe("01:01:01.999");
    expect(formatTimestamp(-2, ",")).toBe("00:00:00,000");
  });

  it("exports standard subtitle and data formats", () => {
    expect(exportTranscript(segments, "txt")).toContain("downloads once.\nThe local");
    expect(exportTranscript(segments, "srt")).toContain("00:00:00,000 --> 00:00:02,250");
    expect(exportTranscript(segments, "vtt")).toMatch(/^WEBVTT/);
    const json = JSON.parse(exportTranscript(segments, "json")) as unknown;
    if (!Array.isArray(json)) throw new Error("Expected a JSON array.");
    const first: unknown = json[0];
    expect(typeof first === "object" && first !== null && "id" in first).toBe(false);
  });

  it("creates deterministic extractive notes in source order", () => {
    const result = summarizeExtractively(segments, 2);
    expect(result).toHaveLength(2);
    expect(result[0]?.start).toBeLessThan(result[1]?.start ?? 0);
    expect(summarizeExtractively(segments, 2).map((segment) => segment.id)).toEqual(result.map((segment) => segment.id));
  });
});
