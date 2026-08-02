import { describe, expect, it } from "vitest";
import {
  isHeic,
  normalizeMetadata,
  renderFilename,
  resolveOutputMime,
} from "./engine";

describe("metadata scrubber engine", () => {
  it("normalizes report values and exposes GPS", () => {
    const report = normalizeMetadata({
      Make: "Example Camera",
      ISO: 200,
      latitude: 51.5074,
      longitude: -0.1278,
      thumbnail: { binary: true },
    });
    expect(report.latitude).toBe(51.5074);
    expect(report.entries).toContainEqual({ key: "Make", value: "Example Camera" });
    expect(report.entries.some((entry) => entry.key === "thumbnail")).toBe(false);
  });

  it("detects unsupported HEIC by MIME or extension", () => {
    expect(isHeic({ name: "photo.HEIC", type: "" })).toBe(true);
    expect(isHeic({ name: "photo", type: "image/heif" })).toBe(true);
    expect(isHeic({ name: "photo.jpg", type: "image/jpeg" })).toBe(false);
  });

  it("preserves Canvas-supported formats and falls back to PNG", () => {
    const supports = (mime: string) => mime === "image/jpeg" || mime === "image/png";
    expect(resolveOutputMime({ name: "a.jpg", type: "image/jpeg" }, "preserve", supports)).toBe("image/jpeg");
    expect(resolveOutputMime({ name: "a.gif", type: "image/gif" }, "preserve", supports)).toBe("image/png");
    expect(() => resolveOutputMime({ name: "a.jpg", type: "image/jpeg" }, "image/webp", supports)).toThrow("not supported");
  });

  it("renders safe batch filenames with templates", () => {
    const name = renderFilename(
      "{name}:clean-{index}-{date}.{ext}",
      { name: "my photo.jpeg" },
      1,
      "image/webp",
      new Date("2026-08-02T00:00:00Z"),
    );
    expect(name).toBe("my photo_clean-002-2026-08-02.webp");
  });
});
