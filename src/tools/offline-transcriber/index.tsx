import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  FileAudioIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  BrowserWhisper,
  type ASRModel,
  type TranscribeProgress,
  type TranscribeStream,
} from "browser-whisper";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadText } from "../../lib/downloads";
import { formatFileSize } from "../../lib/files";
import {
  exportTranscript,
  formatTimestamp,
  makeSegment,
  MAX_MEDIA_DURATION,
  MAX_RECORDING_DURATION,
  MODEL_OPTIONS,
  summarizeExtractively,
  type EditableSegment,
  type ExportFormat,
  validateMediaFile,
} from "./engine";
import "./styles.css";

type JobState = "idle" | "downloading" | "transcribing" | "done" | "error";

function inspectCapabilities() {
  return {
    webgpu: "gpu" in navigator,
    webcodecs: "AudioDecoder" in window,
    wasm: typeof WebAssembly === "object",
    opfs: "storage" in navigator && "getDirectory" in navigator.storage,
    isolated: window.crossOriginIsolated,
    microphone: "mediaDevices" in navigator && "MediaRecorder" in window,
  };
}

async function mediaDuration(file: File): Promise<number> {
  const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
  const url = URL.createObjectURL(file);
  try {
    media.preload = "metadata";
    media.src = url;
    await new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve();
      media.onerror = () => reject(new Error("This browser could not read the media metadata."));
    });
    return media.duration;
  } finally {
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(url);
  }
}

export default function OfflineTranscriber() {
  const [file, setFile] = useState<File>();
  const [mediaUrl, setMediaUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [model, setModel] = useState<ASRModel>("whisper-base_timestamped");
  const [language, setLanguage] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [job, setJob] = useState<JobState>("idle");
  const [progress, setProgress] = useState<TranscribeProgress>({ stage: "loading", progress: 0 });
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [storageUsage, setStorageUsage] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriberRef = useRef<BrowserWhisper | null>(null);
  const streamRef = useRef<TranscribeStream | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const capabilities = useMemo(() => inspectCapabilities(), []);

  useEffect(() => () => {
    transcriberRef.current?.dispose();
    streamRef.current?.cancel();
    downloadAbortRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  }, [mediaUrl]);

  useEffect(() => {
    void navigator.storage.estimate().then(({ usage, quota }) => {
      if (usage !== undefined && quota !== undefined) {
        setStorageUsage(`${formatFileSize(usage)} used of ${formatFileSize(quota)}`);
      }
    });
  }, [modelReady]);

  const selectedModel = MODEL_OPTIONS.find((option) => option.id === model) ?? {
    id: model,
    name: "Selected model",
    size: "size varies",
    detail: "Local speech recognition model",
  };
  const busy = job === "downloading" || job === "transcribing";
  const visibleSegments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? segments.filter((segment) => segment.text.toLocaleLowerCase().includes(normalized))
      : segments;
  }, [query, segments]);
  const notes = useMemo(() => summarizeExtractively(segments), [segments]);

  const resetTranscriber = () => {
    streamRef.current?.cancel();
    streamRef.current = null;
    transcriberRef.current?.dispose();
    transcriberRef.current = null;
    setModelReady(false);
  };

  const loadFile = async (selected?: File) => {
    if (!selected) return;
    setError("");
    const invalid = validateMediaFile(selected);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      const nextDuration = await mediaDuration(selected);
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) throw new Error("The file has no readable audio duration.");
      if (nextDuration > MAX_MEDIA_DURATION) throw new Error("Media is limited to 2 hours per transcription.");
      setFile(selected);
      setDuration(nextDuration);
      setMediaUrl(URL.createObjectURL(selected));
      setSegments([]);
      setQuery("");
      setJob("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open this media file.");
    }
  };

  const getTranscriber = () => {
    const existing = transcriberRef.current;
    if (existing) return existing;
    const options = language ? { model, language } : { model };
    const transcriber = new BrowserWhisper(options);
    transcriberRef.current = transcriber;
    return transcriber;
  };

  const downloadModel = async () => {
    setError("");
    setJob("downloading");
    setProgress({ stage: "loading", progress: 0 });
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      await getTranscriber().downloadModel({
        model,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setModelReady(true);
      setJob("idle");
    } catch (caught) {
      if (controller.signal.aborted) {
        setJob("idle");
      } else {
        setJob("error");
        setError(caught instanceof Error ? caught.message : "The model download failed.");
      }
    } finally {
      if (downloadAbortRef.current === controller) downloadAbortRef.current = null;
    }
  };

  const transcribe = async () => {
    if (!file) return;
    setError("");
    setSegments([]);
    setJob("transcribing");
    setProgress({ stage: "loading", progress: 0 });
    let stream: TranscribeStream | null = null;
    try {
      const options = language
        ? { model, language, onProgress: setProgress }
        : { model, onProgress: setProgress };
      stream = getTranscriber().transcribe(file, options);
      streamRef.current = stream;
      let index = 0;
      for await (const segment of stream) {
        const editable = makeSegment(segment, index++);
        setSegments((current) => [...current, editable]);
      }
      if (streamRef.current === stream) {
        setModelReady(true);
        setJob("done");
        setProgress({ stage: "done", progress: 1 });
      }
    } catch (caught) {
      if (stream !== null && streamRef.current === stream) {
        setJob("error");
        setError(caught instanceof Error ? caught.message : "Transcription failed.");
      }
    } finally {
      streamRef.current = null;
    }
  };

  const cancel = () => {
    downloadAbortRef.current?.abort();
    streamRef.current?.cancel();
    streamRef.current = null;
    setJob("idle");
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      microphoneRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        microphoneRef.current = null;
        recorderRef.current = null;
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        setRecording(false);
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : "webm";
        void loadFile(new File(chunks, `microphone-${new Date().toISOString().replaceAll(":", "-")}.${extension}`, { type }));
      };
      recorder.start(1000);
      setRecordedSeconds(0);
      setRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordedSeconds((seconds) => {
          if (seconds + 1 >= MAX_RECORDING_DURATION && recorder.state === "recording") recorder.stop();
          return seconds + 1;
        });
      }, 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Microphone access failed.");
    }
  };

  const clearCache = async () => {
    if (!window.confirm("Remove all downloaded transcription models from browser storage?")) return;
    setError("");
    try {
      resetTranscriber();
      await BrowserWhisper.clearCache();
      setStorageUsage("Model cache cleared");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear the model cache.");
    }
  };

  const exportFile = (format: ExportFormat) => {
    const stem = file ? file.name.replace(/\.[^.]+$/, "") : "transcript";
    const type = format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
    downloadText(exportTranscript(segments, format), `${stem}.${format}`, type);
  };

  return (
    <div className="ot-app">
      <section className="ot-notices" aria-label="Transcription requirements">
        <div className="ot-first-run">
          <WarningCircleIcon size={20} aria-hidden />
          <div>
            <strong>First run requires a network connection</strong>
            <span>{selectedModel.name} downloads {selectedModel.size}, plus a small WASM runtime. Model files stay in browser storage for later offline use.</span>
          </div>
        </div>
        <div className="ot-capabilities">
          <span className={capabilities.webgpu ? "is-good" : ""}>WebGPU {capabilities.webgpu ? "available" : "unavailable"}</span>
          <span className={capabilities.wasm ? "is-good" : "is-bad"}>WASM {capabilities.wasm ? "available" : "unavailable"}</span>
          <span className={capabilities.webcodecs ? "is-good" : ""}>WebCodecs {capabilities.webcodecs ? "available" : "fallback needed"}</span>
          <span className={capabilities.opfs ? "is-good" : ""}>OPFS {capabilities.opfs ? "available" : "unavailable"}</span>
        </div>
        {!capabilities.isolated && (
          <p className="ot-warning">This page is not cross-origin isolated. WebGPU may work, but threaded WASM fallback can be slower or unavailable.</p>
        )}
      </section>

      <section className="ot-setup">
        <header>
          <div>
            <strong>Model and source</strong>
            <span>Audio stays on this device. Nothing is uploaded.</span>
          </div>
          <span className="ot-model-status">{modelReady ? "Model ready this session" : "Model not loaded this session"}</span>
        </header>
        <div className="ot-controls">
          <label>
            <span>Recognition model</span>
            <select value={model} disabled={busy} onChange={(event) => {
              resetTranscriber();
              setModel(event.target.value as ASRModel);
            }}>
              {MODEL_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.size})</option>)}
            </select>
            <small>{selectedModel.detail}</small>
          </label>
          <label>
            <span>Spoken language</span>
            <select value={language} disabled={busy} onChange={(event) => {
              resetTranscriber();
              setLanguage(event.target.value);
            }}>
              <option value="">Auto detect</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
            </select>
            <small>Distil Small supports English only.</small>
          </label>
          <div className="ot-model-actions">
            <button type="button" onClick={() => void downloadModel()} disabled={busy || !capabilities.wasm}>
              <DownloadSimpleIcon size={17} aria-hidden /> Download model
            </button>
            <button type="button" onClick={() => void clearCache()} disabled={busy}>
              <TrashIcon size={17} aria-hidden /> Clear cache
            </button>
            <small>{capabilities.opfs ? `OPFS cache: ${storageUsage ?? "checking storage"}` : "Persistent OPFS model caching is unavailable."}</small>
          </div>
        </div>
      </section>

      <section className="ot-source">
        <div className="ot-source-copy">
          <FileAudioIcon size={27} aria-hidden />
          <div>
            <strong>{file?.name ?? "Choose local audio or video"}</strong>
            <span>{file ? `${formatFileSize(file.size)} | ${formatTimestamp(duration).slice(0, 8)}` : "Up to 500 MB and 2 hours. Browser-decodable formats only."}</span>
          </div>
        </div>
        <div className="ot-source-actions">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || recording}>Open file</button>
          {capabilities.microphone && (
            <button
              type="button"
              className={recording ? "ot-recording" : ""}
              onClick={() => recording ? recorderRef.current?.stop() : void startRecording()}
              disabled={busy}
            >
              {recording ? <StopIcon size={17} weight="fill" aria-hidden /> : <MicrophoneIcon size={17} aria-hidden />}
              {recording ? `Stop ${formatTimestamp(recordedSeconds).slice(3, 8)}` : "Record microphone"}
            </button>
          )}
          <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*,video/*" onChange={(event) => void loadFile(event.target.files?.[0])} />
        </div>
        {mediaUrl && (
          file?.type.startsWith("video/")
            ? <video className="ot-media" controls preload="metadata" src={mediaUrl} />
            : <audio className="ot-media" controls preload="metadata" src={mediaUrl} />
        )}
      </section>

      {busy && (
        <section className="ot-progress" aria-live="polite">
          <div>
            <strong>{job === "downloading" ? "Preparing model" : "Transcribing locally"}</strong>
            <span>{progress.stage} | {Math.round(progress.progress * 100)}%</span>
          </div>
          <progress max={1} value={progress.progress} />
          <button type="button" onClick={cancel}><StopIcon size={16} aria-hidden /> Cancel</button>
        </section>
      )}

      {error && <div className="ot-error" role="alert"><WarningCircleIcon size={18} aria-hidden /> <span>{error}</span></div>}

      <div className="ot-transcribe-row">
        <div>
          <strong>Ready to transcribe</strong>
          <span>Long recordings can take several minutes. Keep this tab open.</span>
        </div>
        <button className="ot-primary" type="button" disabled={!file || busy || !capabilities.wasm} onClick={() => void transcribe()}>
          <PlayIcon size={17} weight="fill" aria-hidden /> Transcribe
        </button>
      </div>

      <section className="ot-workspace">
        <div className="ot-transcript">
          <header>
            <div>
              <strong>Transcript</strong>
              <span>{segments.length} timestamped segments</span>
            </div>
            <label className="ot-search">
              <MagnifyingGlassIcon size={16} aria-hidden />
              <span className="visually-hidden">Search transcript</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transcript" disabled={!segments.length} />
            </label>
          </header>
          <div className="ot-segments">
            {visibleSegments.length ? visibleSegments.map((segment) => (
              <article key={segment.id}>
                <time>{formatTimestamp(segment.start).slice(0, 8)}</time>
                <textarea
                  aria-label={`Transcript at ${formatTimestamp(segment.start).slice(0, 8)}`}
                  value={segment.text}
                  rows={Math.max(2, Math.ceil(segment.text.length / 80))}
                  onChange={(event) => setSegments((current) => current.map((item) =>
                    item.id === segment.id ? { ...item, text: event.target.value } : item,
                  ))}
                />
              </article>
            )) : (
              <div className="ot-empty">{segments.length ? "No transcript matches your search." : "Timestamped transcript segments will appear here as the model works."}</div>
            )}
          </div>
          <footer>
            <span>Exports use your current edits.</span>
            <div>{(["txt", "srt", "vtt", "json"] as const).map((format) => (
              <button key={format} type="button" disabled={!segments.length} onClick={() => exportFile(format)}>
                <DownloadSimpleIcon size={15} aria-hidden /> {format.toUpperCase()}
              </button>
            ))}</div>
          </footer>
        </div>

        <aside className="ot-notes">
          <header>
            <div>
              <strong>Extractive notes</strong>
              <span>Deterministic keyword ranking. No LLM is used.</span>
            </div>
            <ArrowCounterClockwiseIcon size={18} aria-hidden />
          </header>
          {notes.length ? (
            <ol>{notes.map((segment) => <li key={segment.id}><time>{formatTimestamp(segment.start).slice(0, 8)}</time><p>{segment.text}</p></li>)}</ol>
          ) : <div className="ot-empty">Key transcript segments will be selected after transcription.</div>}
        </aside>
      </section>
    </div>
  );
}
