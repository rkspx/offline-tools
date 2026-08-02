import { describe, expect, it } from "vitest";
import { buildTranscodeArgs, mimeForFormat, outputName, validateMedia } from "./engine";

describe("media transcoder engine", () => {
  it("builds a trimmed H.264 command with scaling and no audio", () => {
    const args = buildTranscodeArgs("input.mov", "out.mp4", {
      format: "mp4",
      quality: "balanced",
      resolution: "720",
      includeAudio: false,
      start: 2,
      end: 8,
      duration: 10,
      hasVideo: true,
    });
    expect(args).toContain("libx264");
    expect(args).toContain("scale=-2:'min(720,ih)'");
    expect(args).toContain("-an");
    expect(args).toContain("6.000");
  });

  it("builds a real PCM WAV output", () => {
    const args = buildTranscodeArgs("input.mp3", "out.wav", {
      format: "wav",
      quality: "high",
      resolution: "source",
      includeAudio: true,
      start: 0,
      end: 3,
      duration: 3,
      hasVideo: false,
    });
    expect(args).toEqual(expect.arrayContaining(["-vn", "-c:a", "pcm_s16le"]));
  });

  it("creates stable names and MIME types", () => {
    expect(outputName("clip.final.mov", "webm")).toBe("clip.final-converted.webm");
    expect(mimeForFormat("mp3")).toBe("audio/mpeg");
  });

  it("rejects excessive files and invalid duration", () => {
    expect(validateMedia({ size: 1_000_000_001 }, 2)).toContain("1 GB");
    expect(validateMedia({ size: 4 }, Number.NaN)).toContain("duration");
  });
});
