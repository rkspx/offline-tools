import { describe, expect, it } from "vitest";
import { compileAndScan, parseYara, SAMPLE_RULES } from "./yara";

describe("YARA-compatible subset", () => {
  it("parses metadata, strings, tags, and conditions", () => {
    const parsed = parseYara(SAMPLE_RULES);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.rules[0]?.tags).toContain("script");
    expect(parsed.rules[0]?.meta.severity).toBe("medium");
  });

  it("matches text, regex, hex, wide, filesize, and uint checks", () => {
    const rules = `rule Combined {
      strings:
        $text = "HELLO" ascii wide nocase
        $hex = { 4D 5A ?? }
        $regex = /token-[0-9]+/ nocase
      condition:
        2 of them and filesize < 1KB and uint16(0) == 23117
    }`;
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, ...new TextEncoder().encode(" hello TOKEN-42")]);
    const result = compileAndScan(rules, bytes);
    expect(result.rules[0]?.matched).toBe(true);
    expect(result.rules[0]?.matches.map((item) => item.id)).toEqual(expect.arrayContaining(["$text", "$hex", "$regex"]));
  });

  it("reports unknown references and malformed declarations", () => {
    const parsed = parseYara("rule Bad { strings: $a = { ZZ } condition: $missing }");
    expect(parsed.diagnostics.map((item) => item.message).join(" ")).toMatch(/Hex strings|Unknown string/);
  });

  it("enforces fullword boundaries for ASCII text and regex strings", () => {
    const rules = `rule Words {
      strings:
        $text = "cat" ascii nocase fullword
        $regex = /dog/ nocase fullword
      condition:
        any of them
    }`;
    const result = compileAndScan(rules, new TextEncoder().encode("scatter CAT dogma dog"));
    expect(result.rules[0]?.matches.filter((item) => item.id === "$text").map((item) => item.offset)).toEqual([8]);
    expect(result.rules[0]?.matches.filter((item) => item.id === "$regex").map((item) => item.offset)).toEqual([18]);
  });

  it("enforces fullword boundaries for wide text strings", () => {
    const rules = `rule WideWord {
      strings:
        $word = "cat" wide fullword
      condition:
        $word
    }`;
    const wide = new Uint8Array(Array.from("scatter cat").flatMap((char) => [char.charCodeAt(0), 0]));
    const result = compileAndScan(rules, wide);
    expect(result.rules[0]?.matches.map((item) => item.offset)).toEqual([16]);
  });
});
