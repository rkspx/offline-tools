/// <reference lib="webworker" />

import { encodeWav, processAudio, type AudioData, type AudioEffects } from "./engine";

type ProcessRequest = {
  data: AudioData;
  start: number;
  end: number;
  effects: AudioEffects;
};

self.onmessage = (event: MessageEvent<ProcessRequest>) => {
  try {
    const output = processAudio(event.data.data, event.data.start, event.data.end, event.data.effects);
    const wav = encodeWav(output);
    self.postMessage({ output, wav }, [...output.channels.map((channel) => channel.buffer), wav]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Audio processing failed." });
  }
};
