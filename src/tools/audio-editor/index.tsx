import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  MagicWandIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { downloadBlob } from "../../lib/downloads";
import { formatFileSize } from "../../lib/files";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION,
  type AudioData,
  type AudioEffects,
} from "./engine";
import "./styles.css";

const DEFAULT_EFFECTS: AudioEffects = {
  removeSilence: false,
  silenceThresholdDb: -45,
  noiseGateDb: -55,
  compressor: false,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  normalize: true,
};

function time(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${Math.floor(value % 60).toString().padStart(2, "0")}.${Math.floor(value % 1 * 10)}`;
}

type WaveformProps = {
  data: AudioData;
  duration: number;
  start: number;
  end: number;
  onSelection: (start: number, end: number) => void;
};

function Waveform({ data, duration, start, end, onSelection }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<number | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const channel = data.channels[0];
    if (!canvas || !channel) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(300, canvas.clientWidth);
    const height = 180;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#111411";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(74, 222, 128, .16)";
    context.fillRect(start / duration * width, 0, (end - start) / duration * width, height);
    context.strokeStyle = "#79d692";
    context.lineWidth = 1;
    context.beginPath();
    const samplesPerPixel = Math.max(1, Math.floor(channel.length / width));
    for (let x = 0; x < width; x += 1) {
      let peak = 0;
      const from = x * samplesPerPixel;
      const to = Math.min(channel.length, from + samplesPerPixel);
      for (let index = from; index < to; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
      context.moveTo(x + 0.5, height / 2 - peak * height * .45);
      context.lineTo(x + 0.5, height / 2 + peak * height * .45);
    }
    context.stroke();
    context.strokeStyle = "rgba(255,255,255,.22)";
    context.beginPath();
    context.moveTo(0, height / 2 + .5);
    context.lineTo(width, height / 2 + .5);
    context.stroke();
  }, [data, duration, end, start]);

  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (event.clientX - bounds.left) / bounds.width * duration));
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const value = position(event);
    dragStart.current = value;
    onSelection(value, value);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragStart.current === undefined || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const value = position(event);
    onSelection(Math.min(dragStart.current, value), Math.max(dragStart.current, value));
  };
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointerMove(event);
    dragStart.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <canvas ref={canvasRef} className="ae-waveform" aria-label="Audio waveform. Drag to select a range." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} />;
}

export default function AudioEditor() {
  const [file, setFile] = useState<File>();
  const [sourceUrl, setSourceUrl] = useState("");
  const [audio, setAudio] = useState<AudioData>();
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [effects, setEffects] = useState<AudioEffects>(DEFAULT_EFFECTS);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; url: string; duration: number }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const load = async (selected: File | undefined) => {
    if (!selected) return;
    setError("");
    setResult(undefined);
    if (selected.size > MAX_AUDIO_BYTES) {
      setError("Audio files are limited to 500 MB.");
      return;
    }
    setProcessing(true);
    try {
      const Context = window.AudioContext;
      const context = new Context();
      try {
        const decoded = await context.decodeAudioData(await selected.arrayBuffer());
        if (decoded.duration > MAX_AUDIO_DURATION) throw new Error("Audio is limited to 30 minutes.");
        if (!decoded.duration || decoded.numberOfChannels === 0) throw new Error("The file contains no decodable audio.");
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index).slice());
        setAudio({ sampleRate: decoded.sampleRate, channels });
        setDuration(decoded.duration);
        setStart(0);
        setEnd(decoded.duration);
        setFile(selected);
        setSourceUrl(URL.createObjectURL(selected));
      } finally {
        await context.close();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not decode this audio file.");
    } finally {
      setProcessing(false);
    }
  };

  const updateEffect = <Key extends keyof AudioEffects>(key: Key, value: AudioEffects[Key]) => {
    setEffects((current) => ({ ...current, [key]: value }));
  };

  const process = () => {
    if (!audio || end - start < 0.05) {
      setError("Select at least 0.05 seconds of audio.");
      return;
    }
    setProcessing(true);
    setError("");
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const channels = audio.channels.map((channel) => channel.slice());
    worker.onmessage = (event: MessageEvent<{ output?: AudioData; wav?: ArrayBuffer; error?: string }>) => {
      setProcessing(false);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = undefined;
      if (event.data.error || !event.data.output || !event.data.wav) {
        setError(event.data.error ?? "Audio processing failed.");
        return;
      }
      const output = event.data.output;
      const blob = new Blob([event.data.wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      setResult((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          blob,
          url,
          duration: (output.channels[0]?.length ?? 0) / output.sampleRate,
        };
      });
    };
    worker.onerror = () => {
      setProcessing(false);
      setError("The audio worker stopped unexpectedly.");
      worker.terminate();
    };
    worker.postMessage({ data: { sampleRate: audio.sampleRate, channels }, start, end, effects }, channels.map((channel) => channel.buffer));
  };

  return (
    <div className="ae-app">
      <section className="ae-upload">
        <div><strong>Source audio</strong><span>Decoded locally with Web Audio · 500 MB / 30 minute limit</span></div>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={processing}><FileArrowUpIcon aria-hidden size={18} /> Open audio</button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*" onChange={(event) => void load(event.target.files?.[0])} />
      </section>

      {audio && file ? (
        <>
          <section className="ae-editor">
            <header>
              <div><strong>{file.name}</strong><span>{formatFileSize(file.size)} · {audio.sampleRate.toLocaleString()} Hz · {audio.channels.length} ch</span></div>
              <span>{time(start)} — {time(end)} / {time(duration)}</span>
            </header>
            <Waveform data={audio} duration={duration} start={start} end={end} onSelection={(from, to) => { setStart(from); setEnd(to); }} />
            <footer>
              <label>Selection start <input type="number" min={0} max={end} step={0.01} value={start.toFixed(2)} onChange={(event) => setStart(Math.max(0, Math.min(Number(event.target.value), end)))} /></label>
              <label>Selection end <input type="number" min={start} max={duration} step={0.01} value={end.toFixed(2)} onChange={(event) => setEnd(Math.max(start, Math.min(Number(event.target.value), duration)))} /></label>
              <button type="button" onClick={() => { setStart(0); setEnd(duration); }}>Select all</button>
            </footer>
          </section>

          <section className="ae-effects">
            <header><div><strong>Cleanup chain</strong><span>Applied in order in a dedicated worker.</span></div></header>
            <div className="ae-effect-grid">
              <label className="ae-switch"><input type="checkbox" checked={effects.removeSilence} onChange={(event) => updateEffect("removeSilence", event.target.checked)} /><span><strong>Remove silence</strong><small>Cut quiet regions with 20 ms padding</small></span></label>
              <label>Silence threshold <output>{effects.silenceThresholdDb} dB</output><input type="range" min={-70} max={-20} value={effects.silenceThresholdDb} onChange={(event) => updateEffect("silenceThresholdDb", Number(event.target.value))} /></label>
              <label>Noise gate <output>{effects.noiseGateDb} dB</output><input type="range" min={-80} max={-20} value={effects.noiseGateDb} onChange={(event) => updateEffect("noiseGateDb", Number(event.target.value))} /></label>
              <label className="ae-switch"><input type="checkbox" checked={effects.compressor} onChange={(event) => updateEffect("compressor", event.target.checked)} /><span><strong>Compressor</strong><small>4:1 above −18 dB</small></span></label>
              <label>Low EQ <output>{effects.eqLowDb > 0 ? "+" : ""}{effects.eqLowDb} dB</output><input type="range" min={-12} max={12} value={effects.eqLowDb} onChange={(event) => updateEffect("eqLowDb", Number(event.target.value))} /></label>
              <label>Mid EQ <output>{effects.eqMidDb > 0 ? "+" : ""}{effects.eqMidDb} dB</output><input type="range" min={-12} max={12} value={effects.eqMidDb} onChange={(event) => updateEffect("eqMidDb", Number(event.target.value))} /></label>
              <label>High EQ <output>{effects.eqHighDb > 0 ? "+" : ""}{effects.eqHighDb} dB</output><input type="range" min={-12} max={12} value={effects.eqHighDb} onChange={(event) => updateEffect("eqHighDb", Number(event.target.value))} /></label>
              <label className="ae-switch"><input type="checkbox" checked={effects.normalize} onChange={(event) => updateEffect("normalize", event.target.checked)} /><span><strong>Peak normalize</strong><small>Set output peak to −1 dBFS</small></span></label>
            </div>
            <footer><span>EQ uses lightweight three-band crossover filters. WAV export is 16-bit PCM.</span><button className="ae-primary" type="button" disabled={processing} onClick={process}><MagicWandIcon aria-hidden size={18} /> {processing ? "Processing…" : "Apply effects"}</button></footer>
          </section>

          <section className="ae-compare">
            <div><strong>Before</strong><audio controls src={sourceUrl} /></div>
            <div><strong>After</strong>{result ? <audio controls src={result.url} /> : <span>Apply effects to create a preview.</span>}</div>
            {result && <div className="ae-export"><span>{time(result.duration)} · {formatFileSize(result.blob.size)}</span><button className="ae-primary" type="button" onClick={() => downloadBlob(result.blob, `${file.name.replace(/\.[^.]+$/, "") || "audio"}-edited.wav`)}><DownloadSimpleIcon aria-hidden size={18} /> Export WAV</button></div>}
          </section>
        </>
      ) : <div className="ae-empty">{processing ? "Decoding audio locally…" : "Open an audio file to draw its waveform and select a range."}</div>}

      {error && <div className="ae-error" role="alert"><WarningCircleIcon aria-hidden size={18} />{error}</div>}
    </div>
  );
}
