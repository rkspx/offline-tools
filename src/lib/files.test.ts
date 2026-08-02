import { describe, expect, it } from "vitest";
import { fileExtension, formatFileSize, readFileText } from "./files";

describe("file utilities", () => {
  it("formats decimal file sizes", () => {
    expect(formatFileSize(999)).toBe("999 B");
    expect(formatFileSize(1_500)).toBe("1.5 KB");
  });

  it("normalizes file extensions", () => {
    expect(fileExtension("REPORT.CSV")).toBe("csv");
    expect(fileExtension("README")).toBe("");
  });

  it("reads file text", async () => {
    await expect(readFileText(new File(["local"], "note.txt"))).resolves.toBe("local");
  });
});
