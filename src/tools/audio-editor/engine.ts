export type AudioData = {
  sampleRate: number;
  channels: Float32Array[];
};

export type AudioEffects = {
  removeSilence: boolean;
  silenceThresholdDb: number;
  noiseGateDb: number;
  compressor: boolean;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  normalize: boolean;
};

export const MAX_AUDIO_BYTES = 500_000_000;
export const MAX_AUDIO_DURATION = 30 * 60;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function selectionFrames(data: AudioData, start: number, end: number): [number, number] {
  const length = data.channels[0]?.length ?? 0;
  const from = Math.max(0, Math.min(length, Math.round(start * data.sampleRate)));
  const to = Math.max(from, Math.min(length, Math.round(end * data.sampleRate)));
  return [from, to];
}

function removeSilentFrames(channels: Float32Array[], threshold: number, sampleRate: number): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const padding = Math.round(sampleRate * 0.02);
  const keep = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    if (peak >= threshold) {
      const from = Math.max(0, index - padding);
      const to = Math.min(length, index + padding + 1);
      keep.fill(1, from, to);
    }
  }
  let count = 0;
  for (const value of keep) count += value;
  if (count === 0) return channels.map(() => new Float32Array(1));
  return channels.map((channel) => {
    const output = new Float32Array(count);
    let cursor = 0;
    for (let index = 0; index < length; index += 1) {
      if (keep[index]) output[cursor++] = channel[index] ?? 0;
    }
    return output;
  });
}

function applyEq(channel: Float32Array, sampleRate: number, lowDb: number, midDb: number, highDb: number): void {
  const lowGain = dbToGain(lowDb);
  const midGain = dbToGain(midDb);
  const highGain = dbToGain(highDb);
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 250 / sampleRate);
  const highAlpha = 1 - Math.exp(-2 * Math.PI * 4000 / sampleRate);
  let low = 0;
  let highLowPass = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const sample = channel[index] ?? 0;
    low += lowAlpha * (sample - low);
    highLowPass += highAlpha * (sample - highLowPass);
    const high = sample - highLowPass;
    const mid = sample - low - high;
    channel[index] = low * lowGain + mid * midGain + high * highGain;
  }
}

export function processAudio(data: AudioData, start: number, end: number, effects: AudioEffects): AudioData {
  const [from, to] = selectionFrames(data, start, end);
  let channels: Float32Array[] = data.channels.map((channel) => channel.slice(from, to));
  if (effects.removeSilence) {
    channels = removeSilentFrames(channels, dbToGain(effects.silenceThresholdDb), data.sampleRate);
  }

  const gate = dbToGain(effects.noiseGateDb);
  for (const channel of channels) {
    applyEq(channel, data.sampleRate, effects.eqLowDb, effects.eqMidDb, effects.eqHighDb);
    for (let index = 0; index < channel.length; index += 1) {
      let sample = channel[index] ?? 0;
      if (Math.abs(sample) < gate) sample = 0;
      if (effects.compressor) {
        const sign = Math.sign(sample);
        const absolute = Math.abs(sample);
        const threshold = dbToGain(-18);
        if (absolute > threshold) sample = sign * (threshold + (absolute - threshold) / 4);
      }
      channel[index] = sample;
    }
  }

  if (effects.normalize) {
    let peak = 0;
    for (const channel of channels) {
      for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
    }
    const gain = peak > 0 ? dbToGain(-1) / peak : 1;
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = Math.max(-1, Math.min(1, (channel[index] ?? 0) * gain));
      }
    }
  }
  return { sampleRate: data.sampleRate, channels };
}

export function encodeWav(data: AudioData): ArrayBuffer {
  const channelCount = Math.max(1, data.channels.length);
  const frameCount = data.channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + frameCount * channelCount * bytesPerSample);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, data.sampleRate, true);
  view.setUint32(28, data.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, frameCount * channelCount * bytesPerSample, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data.channels[channel]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += bytesPerSample;
    }
  }
  return buffer;
}
