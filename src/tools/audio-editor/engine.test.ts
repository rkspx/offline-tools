import { describe, expect, it } from "vitest";
import { dbToGain, encodeWav, processAudio, selectionFrames, type AudioEffects } from "./engine";

const effects: AudioEffects = {
  removeSilence: false,
  silenceThresholdDb: -45,
  noiseGateDb: -80,
  compressor: false,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  normalize: false,
};

describe("audio editor engine", () => {
  it("maps a time selection to bounded sample frames", () => {
    const data = { sampleRate: 10, channels: [new Float32Array(100)] };
    expect(selectionFrames(data, -2, 20)).toEqual([0, 100]);
    expect(selectionFrames(data, 1, 2.5)).toEqual([10, 25]);
  });

  it("trims and peak-normalizes channels", () => {
    const data = { sampleRate: 2, channels: [new Float32Array([0, 0.25, -0.5, 0])] };
    const output = processAudio(data, 0.5, 1.5, { ...effects, normalize: true });
    expect(output.channels[0]).toHaveLength(2);
    expect(Math.abs(output.channels[0]?.[1] ?? 0)).toBeCloseTo(dbToGain(-1));
  });

  it("removes silence while retaining active material", () => {
    const samples = new Float32Array(100);
    samples[50] = 0.5;
    const output = processAudio(
      { sampleRate: 100, channels: [samples] },
      0,
      1,
      { ...effects, removeSilence: true, silenceThresholdDb: -20 },
    );
    expect(output.channels[0]?.length).toBeLessThan(100);
    expect(Array.from(output.channels[0] ?? [])).toContain(0.5);
  });

  it("encodes valid 16-bit PCM WAV headers", () => {
    const wav = encodeWav({ sampleRate: 48_000, channels: [new Float32Array([0, 1, -1])] });
    const view = new DataView(wav);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(wav.byteLength).toBe(50);
  });
});
