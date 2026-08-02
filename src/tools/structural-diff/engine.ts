import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type DataFormat = "json" | "yaml" | "xml";
export type DiffKind = "added" | "removed" | "changed" | "type";
export type MergeSide = "left" | "right";
export type PathPart = string | number;

export type DiffEntry = {
  path: PathPart[];
  kind: DiffKind;
  left?: unknown;
  right?: unknown;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: false,
});

// XMLBuilder is the serializer bundled with the installed parser dependency.
// eslint-disable-next-line @typescript-eslint/no-deprecated
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "  ",
});

export function parseStructured(text: string, format: DataFormat): unknown {
  if (!text.trim()) throw new Error("Add some content before comparing.");
  try {
    if (format === "json") return JSON.parse(text);
    if (format === "yaml") return parseYaml(text);
    return xmlParser.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Could not parse ${format.toUpperCase()}: ${message}`);
  }
}

export function serializeStructured(value: unknown, format: DataFormat): string {
  if (format === "json") return JSON.stringify(value, null, 2);
  if (format === "yaml") return stringifyYaml(value, { indent: 2 });
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    return xmlBuilder.build({ root: value });
  }
  return xmlBuilder.build(value);
}

export function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

export function diffStructures(left: unknown, right: unknown, path: PathPart[] = []): DiffEntry[] {
  const leftType = valueType(left);
  const rightType = valueType(right);
  if (leftType !== rightType) return [{ path, kind: "type", left, right }];

  if (Array.isArray(left) && Array.isArray(right)) {
    const changes: DiffEntry[] = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length) changes.push({ path: [...path, index], kind: "added", right: right[index] });
      else if (index >= right.length) changes.push({ path: [...path, index], kind: "removed", left: left[index] });
      else changes.push(...diffStructures(left[index], right[index], [...path, index]));
    }
    return changes;
  }

  if (isRecord(left) && isRecord(right)) {
    const changes: DiffEntry[] = [];
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left)) changes.push({ path: [...path, key], kind: "added", right: right[key] });
      else if (!(key in right)) changes.push({ path: [...path, key], kind: "removed", left: left[key] });
      else changes.push(...diffStructures(left[key], right[key], [...path, key]));
    }
    return changes;
  }

  return Object.is(left, right) ? [] : [{ path, kind: "changed", left, right }];
}

export function pathKey(path: PathPart[]): string {
  return JSON.stringify(path);
}

export function formatPath(path: PathPart[]): string {
  if (!path.length) return "$";
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number"
        ? `${result}[${part}]`
        : `${result}${/^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`}`,
    "$",
  );
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function setAtPath(root: unknown, path: PathPart[], value: unknown, remove: boolean): unknown {
  if (!path.length) return remove ? undefined : cloneValue(value);
  const output = cloneValue(root);
  let cursor = output as Record<string | number, unknown>;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    if (part === undefined) return output;
    const next = path[index + 1];
    if (!isContainer(cursor[part])) cursor[part] = typeof next === "number" ? [] : {};
    cursor = cursor[part] as Record<string | number, unknown>;
  }
  const leaf = path[path.length - 1];
  if (leaf === undefined) return output;
  if (remove) {
    if (Array.isArray(cursor) && typeof leaf === "number") cursor.splice(leaf, 1);
    else Reflect.deleteProperty(cursor, leaf);
  } else {
    cursor[leaf] = cloneValue(value);
  }
  return output;
}

export function mergeStructures(
  left: unknown,
  changes: DiffEntry[],
  choices: Record<string, MergeSide>,
): unknown {
  let merged = cloneValue(left);
  const ordered = [...changes].sort((a, b) => {
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    const aLeaf = a.path[a.path.length - 1];
    const bLeaf = b.path[b.path.length - 1];
    return typeof aLeaf === "number" && typeof bLeaf === "number" ? bLeaf - aLeaf : 0;
  });

  for (const change of ordered) {
    if ((choices[pathKey(change.path)] ?? "left") === "left") continue;
    merged = setAtPath(merged, change.path, change.right, change.kind === "removed");
  }
  return merged;
}
