import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  StopCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "../../lib/downloads";
import { formatFileSize } from "../../lib/files";
import {
  buildTranscodeArgs,
  isVideoFormat,
  MAX_MEDIA_BYTES,
  mimeForFormat,
  outputName,
  validateMedia,
  type OutputFormat,
  type OutputQuality,
  type OutputResolution,
} from "./engine";
import "./styles.css";

type LoadedMedia = {
  file: File;
  url: string;
  duration: number;
  hasVideo: boolean;
};

const CORE_URL = `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`;
const WASM_URL = `${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.wasm`;

async function localAssetUrl(url: string, type: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the local FFmpeg asset (${response.status}).`);
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export default function MediaTranscoder() {
  const [media, setMedia] = useState<LoadedMedia>();
  const [pending, setPending] = useState<{ file: File; url: string; hasVideo: boolean }>();
  const [format, setFormat] = useState<OutputFormat>("mp4");
  const [quality, setQuality] = useState<OutputQuality>("balanced");
  const [resolution, setResolution] = useState<OutputResolution>("source");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; url: string; name: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | undefined>(undefined);

  useEffect(() => () => {
    if (media) URL.revokeObjectURL(media.url);
  }, [media]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  useEffect(() => () => {
    ffmpegRef.current?.terminate();
  }, []);

  const memoryWarning = useMemo(() => {
    if (!media) return "";
    const estimated = media.file.size * 3;
    return estimated > 600_000_000
      ? `This job may use more than ${formatFileSize(estimated)} of memory because FFmpeg keeps input and output copies. Close other tabs first.`
      : "";
  }, [media]);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError("");
    setResult(undefined);
    if (file.size > MAX_MEDIA_BYTES) {
      setError("Files are limited to 1 GB to avoid exhausting browser memory.");
      return;
    }
    if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
      setError("Choose a browser-readable video or audio file.");
      return;
    }
    if (pending) URL.revokeObjectURL(pending.url);
    const hasVideo = file.type.startsWith("video/");
    setPending({ file, url: URL.createObjectURL(file), hasVideo });
    if (!hasVideo) setFormat("mp3");
  };

  const metadataReady = (duration: number) => {
    if (!pending) return;
    const validation = validateMedia(pending.file, duration);
    if (validation) {
      setError(validation);
      URL.revokeObjectURL(pending.url);
      setPending(undefined);
      return;
    }
    setMedia({ ...pending, duration });
    setPending(undefined);
    setStart(0);
    setEnd(duration);
  };

  const cancel = () => {
    ffmpegRef.current?.terminate();
    ffmpegRef.current = undefined;
    setRunning(false);
    setStatus("Cancelled. FFmpeg memory was released.");
    setProgress(0);
  };

  const transcode = async () => {
    if (!media) return;
    setRunning(true);
    setError("");
    setProgress(0);
    setStatus("Loading the local FFmpeg engine…");
    const rawExtension = media.file.name.split(".").pop() ?? "bin";
    const sanitizedExtension = rawExtension.replace(/[^a-z0-9]/gi, "");
    const inputExtension = sanitizedExtension.length > 0 ? sanitizedExtension : "bin";
    const inputPath = `input.${inputExtension}`;
    const name = outputName(media.file.name, format);
    const outputPath = `output.${format}`;
    const ffmpeg = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = ffmpeg;
    const onProgress = ({ progress: value }: { progress: number }) => setProgress(Math.max(0, Math.min(1, value)));
    ffmpeg.on("progress", onProgress);
    try {
      if (!ffmpeg.loaded) {
        const coreBlobUrl = await localAssetUrl(CORE_URL, "text/javascript");
        const wasmBlobUrl = await localAssetUrl(WASM_URL, "application/wasm");
        try {
          await ffmpeg.load({ coreURL: coreBlobUrl, wasmURL: wasmBlobUrl });
        } finally {
          URL.revokeObjectURL(coreBlobUrl);
          URL.revokeObjectURL(wasmBlobUrl);
        }
      }
      setStatus("Copying media into private working memory…");
      await ffmpeg.writeFile(inputPath, new Uint8Array(await media.file.arrayBuffer()));
      setStatus("Transcoding locally…");
      const exitCode = await ffmpeg.exec(buildTranscodeArgs(inputPath, outputPath, {
        format,
        quality,
        resolution,
        includeAudio,
        start,
        end,
        duration: media.duration,
        hasVideo: media.hasVideo,
      }));
      if (exitCode !== 0) throw new Error(`FFmpeg stopped with exit code ${exitCode}. This codec or source may not be supported.`);
      const data = await ffmpeg.readFile(outputPath);
      if (typeof data === "string") throw new Error("FFmpeg returned unexpected text output.");
      const bytes = new Uint8Array(data);
      const blob = new Blob([bytes.slice().buffer], { type: mimeForFormat(format) });
      const url = URL.createObjectURL(blob);
      setResult((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { blob, url, name };
      });
      setProgress(1);
      setStatus(`Finished · ${formatFileSize(blob.size)}`);
      await Promise.allSettled([ffmpeg.deleteFile(inputPath), ffmpeg.deleteFile(outputPath)]);
    } catch (caught) {
      if (ffmpegRef.current === ffmpeg) {
        setError(caught instanceof Error ? caught.message : "Transcoding failed.");
        setStatus("");
      }
    } finally {
      ffmpeg.off("progress", onProgress);
      if (ffmpegRef.current === ffmpeg) setRunning(false);
    }
  };

  const preview = pending ?? media;
  return (
    <div className="mt-app">
      <section className="mt-upload">
        <div>
          <strong>Source media</strong>
          <span>Nothing is uploaded. Maximum 1 GB or two hours.</span>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={running}>
          <FileArrowUpIcon aria-hidden size={18} /> Choose media
        </button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="video/*,audio/*" onChange={(event) => chooseFile(event.target.files?.[0])} />
      </section>

      {preview ? (
        <section className="mt-grid">
          <div className="mt-preview">
            {preview.hasVideo ? (
              <video controls src={preview.url} onLoadedMetadata={(event) => metadataReady(event.currentTarget.duration)} />
            ) : (
              <audio controls src={preview.url} onLoadedMetadata={(event) => metadataReady(event.currentTarget.duration)} />
            )}
            <div className="mt-fileline">
              <strong>{preview.file.name}</strong>
              <span>{formatFileSize(preview.file.size)}{media ? ` · ${formatTime(media.duration)}` : " · Reading metadata…"}</span>
            </div>
          </div>

          <div className="mt-controls">
            <h2>Output</h2>
            <div className="mt-control-grid">
              <label>Format
                <select value={format} onChange={(event) => setFormat(event.target.value as OutputFormat)} disabled={running}>
                  {media?.hasVideo && <><option value="mp4">MP4 · H.264</option><option value="webm">WebM · VP9</option></>}
                  <option value="mp3">MP3 audio</option>
                  <option value="m4a">M4A audio</option>
                  <option value="wav">WAV audio</option>
                </select>
              </label>
              <label>Quality
                <select value={quality} onChange={(event) => setQuality(event.target.value as OutputQuality)} disabled={running}>
                  <option value="small">Smaller file</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High quality</option>
                </select>
              </label>
              <label>Resolution
                <select value={resolution} onChange={(event) => setResolution(event.target.value as OutputResolution)} disabled={running || !isVideoFormat(format)}>
                  <option value="source">Keep source</option><option value="1080">1080p max</option><option value="720">720p max</option><option value="480">480p max</option>
                </select>
              </label>
              <label className="mt-check">
                <input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} disabled={running || !isVideoFormat(format)} />
                Include audio
              </label>
            </div>
            {media && (
              <div className="mt-trim">
                <div><strong>Trim range</strong><span>{formatTime(start)} — {formatTime(end)}</span></div>
                <label>Start <input type="range" min={0} max={media.duration} step={0.05} value={start} onChange={(event) => setStart(Math.min(Number(event.target.value), end - 0.05))} disabled={running} /></label>
                <label>End <input type="range" min={0} max={media.duration} step={0.05} value={end} onChange={(event) => setEnd(Math.max(Number(event.target.value), start + 0.05))} disabled={running} /></label>
              </div>
            )}
          </div>
        </section>
      ) : <div className="mt-empty">Choose an audio or video file to preview it and configure conversion.</div>}

      {(memoryWarning || !crossOriginIsolated) && (
        <div className="mt-warning"><WarningCircleIcon aria-hidden size={18} /><span>{memoryWarning || "Cross-origin isolation is unavailable. The single-thread engine can still run, but conversion will be slower."}</span></div>
      )}
      {error && <div className="mt-error" role="alert"><WarningCircleIcon aria-hidden size={18} />{error}</div>}

      {media && (
        <section className="mt-run">
          <div>
            <div className="mt-progress"><span style={{ width: `${progress * 100}%` }} /></div>
            <span>{status || "FFmpeg runs in a local worker. Large jobs can take several minutes."}</span>
          </div>
          {running ? (
            <button type="button" onClick={cancel}><StopCircleIcon aria-hidden size={18} /> Cancel</button>
          ) : (
            <button className="mt-primary" type="button" onClick={() => void transcode()}>Convert locally</button>
          )}
        </section>
      )}

      {result && (
        <section className="mt-result">
          <div>
            <strong>Output ready</strong>
            <span>{result.name} · {formatFileSize(result.blob.size)}</span>
          </div>
          {isVideoFormat(format) ? <video controls src={result.url} /> : <audio controls src={result.url} />}
          <button className="mt-primary" type="button" onClick={() => downloadBlob(result.blob, result.name)}>
            <DownloadSimpleIcon aria-hidden size={18} /> Download
          </button>
        </section>
      )}
    </div>
  );
}
