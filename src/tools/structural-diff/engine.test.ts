import { describe, expect, it } from "vitest";
import {
  diffStructures,
  formatPath,
  mergeStructures,
  parseStructured,
  pathKey,
  serializeStructured,
} from "./engine";

describe("structural diff engine", () => {
  it("parses JSON, YAML, and XML into comparable values", () => {
    expect(parseStructured('{"count":2}', "json")).toEqual({ count: 2 });
    expect(parseStructured("count: 2", "yaml")).toEqual({ count: 2 });
    expect(parseStructured("<root><count>2</count></root>", "xml")).toEqual({
      root: { count: 2 },
    });
  });

  it("reports added, removed, changed, and type changes recursively", () => {
    const changes = diffStructures(
      { keep: true, changed: 1, removed: "x", nested: { value: 1 } },
      { keep: true, changed: 2, added: "y", nested: { value: "1" } },
    );
    expect(changes.map(({ kind, path }) => [kind, formatPath(path)])).toEqual([
      ["added", "$.added"],
      ["changed", "$.changed"],
      ["type", "$.nested.value"],
      ["removed", "$.removed"],
    ]);
  });

  it("merges per-change selections without mutating either input", () => {
    const left = { name: "old", list: [1, 2], removeMe: true };
    const right = { name: "new", list: [1, 3, 4] };
    const changes = diffStructures(left, right);
    const choices = Object.fromEntries(changes.map((change) => [pathKey(change.path), "right" as const]));
    expect(mergeStructures(left, changes, choices)).toEqual(right);
    expect(left).toEqual({ name: "old", list: [1, 2], removeMe: true });
  });

  it("serializes merged data to every supported format", () => {
    const value = { root: { enabled: true } };
    expect(serializeStructured(value, "json")).toContain('"enabled": true');
    expect(serializeStructured(value, "yaml")).toContain("enabled: true");
    expect(serializeStructured(value, "xml")).toContain("<enabled>true</enabled>");
  });
});
