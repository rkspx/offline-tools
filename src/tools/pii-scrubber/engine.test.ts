import { describe, expect, it } from "vitest";
import { generalizeValue, inferFindings, parseCsv, scrubRows, sha256 } from "./engine";

describe("PII scrubber engine", () => {
  it("parses CSV and infers PII from headers and values", () => {
    const data = parseCsv("name,email,ip\nAda Lovelace,ada@example.com,192.168.1.4");
    const findings = inferFindings(data);
    expect(findings.find((item) => item.column === "email")?.kinds).toContain("email");
    expect(findings.find((item) => item.column === "name")?.kinds).toContain("name");
    expect(findings.find((item) => item.column === "ip")?.suggestedAction).toBe("generalize");
  });

  it("validates malformed source data", () => {
    expect(() => parseCsv("")).toThrow("Paste CSV");
    expect(() => parseCsv("name,name\none,two")).toThrow("unique");
  });

  it("generalizes common identifiers without exposing full values", () => {
    expect(generalizeValue("ada@example.com", "email")).toBe("***@example.com");
    expect(generalizeValue("192.168.1.4", "ip-address")).toBe("192.168.1.0/24");
    expect(generalizeValue("1988-04-12", "date")).toBe("1988");
  });

  it("uses salted WebCrypto SHA-256", async () => {
    const first = await sha256("secret", "salt-a");
    expect(first).toHaveLength(64);
    expect(first).toBe(await sha256("secret", "salt-a"));
    expect(first).not.toBe(await sha256("secret", "salt-b"));
  });

  it("creates deterministic session tokens for repeated values", async () => {
    const data = parseCsv("email\nsame@example.com\nsame@example.com\nother@example.com");
    const findings = inferFindings(data);
    const tokenMap = new Map<string, string>();
    const rows = await scrubRows(data, { email: "tokenize" }, findings, {
      salt: "test",
      tokenMap,
    });
    expect(rows.map((row) => row.email)).toEqual(["EMAIL_0001", "EMAIL_0001", "EMAIL_0002"]);
    const later = parseCsv("email\nthird@example.com");
    expect((await scrubRows(later, { email: "tokenize" }, inferFindings(later), {
      salt: "test",
      tokenMap,
    }))[0]?.email).toBe("EMAIL_0003");
  });
});
