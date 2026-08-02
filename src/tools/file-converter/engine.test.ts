import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  classifyFile,
  encodeWav,
  extension,
  mergePdfs,
  splitPdf,
  stem,
  unsupportedReason,
} from "./engine";

describe("file converter engine", () => {
  it("classifies supported inputs using MIME or extension", () => {
    expect(classifyFile(new File(["x"], "photo.HEIC"))).toBe("image");
    expect(classifyFile(new File(["x"], "scan", { type: "application/pdf" }))).toBe("pdf");
    expect(classifyFile(new File(["x"], "voice.m4a"))).toBe("audio");
    expect(classifyFile(new File(["x"], "archive.zip"))).toBe("unsupported");
  });

  it("handles names and precise unsupported messages", () => {
    expect(extension("report.final.PDF")).toBe("pdf");
    expect(stem("report.final.PDF")).toBe("report.final");
    expect(unsupportedReason(new File(["x"], "notes.txt"))).toContain("Unsupported input");
  });

  it("encodes interleaved 16-bit PCM WAV data", async () => {
    const blob = encodeWav([
      new Float32Array([-1, 0, 1]),
      new Float32Array([0.5, -0.5, 0]),
    ], 48_000);
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 3 * 2 * 2);
    expect(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4))).toBe("RIFF");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
  });

  it("merges and splits PDF pages", async () => {
    const makePdf = async (pages: number) => {
      const document = await PDFDocument.create();
      for (let index = 0; index < pages; index += 1) document.addPage([100, 100]);
      return new File([new Uint8Array(await document.save())], `${pages}.pdf`, { type: "application/pdf" });
    };
    const merged = await mergePdfs([await makePdf(1), await makePdf(2)]);
    expect((await PDFDocument.load(await merged.arrayBuffer())).getPageCount()).toBe(3);
    const parts = await splitPdf(new File([merged], "merged.pdf", { type: "application/pdf" }));
    expect(parts).toHaveLength(3);
    const firstPart = parts[0];
    if (!firstPart) throw new Error("Expected the first split PDF page.");
    expect((await PDFDocument.load(await firstPart.arrayBuffer())).getPageCount()).toBe(1);
  });
});
