import type { Capability } from "../types/tool";

export type CapabilityReport = Readonly<Record<Capability, boolean>>;

export function detectCapabilities(): CapabilityReport {
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated,
    fileSystemAccess: "showOpenFilePicker" in globalThis,
    webCodecs: "VideoEncoder" in globalThis && "AudioEncoder" in globalThis,
    webGpu: "gpu" in navigator,
  };
}

export function missingCapabilities(required: readonly Capability[]): Capability[] {
  const available = detectCapabilities();
  return required.filter((capability) => !available[capability]);
}
