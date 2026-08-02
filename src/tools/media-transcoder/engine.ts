export type OutputFormat = "mp4" | "webm" | "mp3" | "wav" | "m4a";
export type OutputQuality = "small" | "balanced" | "high";
export type OutputResolution = "source" | "1080" | "720" | "480";

export type TranscodeOptions = {
  format: OutputFormat;
  quality: OutputQuality;
  resolution: OutputResolution;
  includeAudio: boolean;
  start: number;
  end: number;
  duration: number;
  hasVideo: boolean;
};

export const MAX_MEDIA_BYTES = 1_000_000_000;
export const MAX_MEDIA_DURATION = 2 * 60 * 60;

const VIDEO_FORMATS = new Set<OutputFormat>(["mp4", "webm"]);

export function isVideoFormat(format: OutputFormat): boolean {
  return VIDEO_FORMATS.has(format);
}

export function validateMedia(file: Pick<File, "size">, duration: number): string | undefined {
  if (file.size > MAX_MEDIA_BYTES) return "Files are limited to 1 GB to avoid exhausting browser memory.";
  if (duration > MAX_MEDIA_DURATION) return "Media is limited to two hours.";
  if (!Number.isFinite(duration) || duration <= 0) return "Could not determine a valid media duration.";
  return undefined;
}

export function outputName(inputName: string, format: OutputFormat): string {
  const stem = inputName.replace(/\.[^.]+$/, "") || "output";
  return `${stem}-converted.${format}`;
}

export function mimeForFormat(format: OutputFormat): string {
  return {
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
  }[format];
}

export function buildTranscodeArgs(inputName: string, outputNameValue: string, options: TranscodeOptions): string[] {
  const start = Math.max(0, Math.min(options.start, options.duration));
  const end = Math.max(start, Math.min(options.end, options.duration));
  if (end - start < 0.05) throw new Error("Choose a trim range of at least 0.05 seconds.");

  const args = ["-ss", start.toFixed(3), "-i", inputName, "-t", (end - start).toFixed(3)];
  if (!isVideoFormat(options.format) || !options.hasVideo) {
    args.push("-vn");
  } else {
    const scale = options.resolution === "source"
      ? undefined
      : `scale=-2:'min(${options.resolution},ih)'`;
    if (scale) args.push("-vf", scale);
    if (options.format === "mp4") {
      const crf = { small: "30", balanced: "24", high: "18" }[options.quality];
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    } else {
      const crf = { small: "40", balanced: "32", high: "24" }[options.quality];
      args.push("-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0");
    }
  }

  if (!options.includeAudio && isVideoFormat(options.format)) {
    args.push("-an");
  } else if (options.format === "wav") {
    args.push("-c:a", "pcm_s16le");
  } else if (options.format === "mp3") {
    args.push("-c:a", "libmp3lame", "-q:a", { small: "7", balanced: "4", high: "2" }[options.quality]);
  } else {
    args.push("-c:a", "aac", "-b:a", { small: "96k", balanced: "160k", high: "256k" }[options.quality]);
  }
  args.push(outputNameValue);
  return args;
}
