import { diffWordsWithSpace, type Change } from "diff";
import JSZip from "jszip";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type RedlinePart = {
  value: string;
  kind: "same" | "added" | "removed";
};

export type RiskFlag = {
  id: string;
  label: string;
  explanation: string;
  excerpt: string;
};

const RISK_RULES = [
  {
    label: "Automatic renewal",
    pattern: /\b(auto(?:matic(?:ally)?)?[- ]?renew(?:al|s|ed)?|evergreen)\b/i,
    explanation: "May extend the agreement unless notice is given within a specific window.",
  },
  {
    label: "Broad indemnity",
    pattern: /\b(indemnif(?:y|ies|ication)|hold harmless)\b/i,
    explanation: "May shift losses, claims, or legal costs from one party to the other.",
  },
  {
    label: "Liability limitation",
    pattern: /\b(limit(?:ation)? of liability|liability (?:is )?(?:limited|capped)|consequential damages)\b/i,
    explanation: "May cap available remedies or exclude categories of damages.",
  },
  {
    label: "Unilateral change",
    pattern: /\b(at (?:our|its) sole discretion|may modify .* at any time|without (?:prior )?notice)\b/i,
    explanation: "May permit one party to change terms without the other party's approval.",
  },
  {
    label: "Termination restriction",
    pattern: /\b(early termination (?:fee|penalty)|non[- ]?cancellable|irrevocable)\b/i,
    explanation: "May make ending the agreement costly or difficult.",
  },
  {
    label: "Mandatory dispute forum",
    pattern: /\b(binding arbitration|exclusive jurisdiction|waive.{0,30}(?:jury|class action))\b/i,
    explanation: "May restrict where or how disputes can be brought.",
  },
] as const;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  const archive = await JSZip.loadAsync(bytes);
  const entry = archive.file("word/document.xml");
  if (!entry) throw new Error("This DOCX does not contain word/document.xml.");
  const xml = await entry.async("string");
  return decodeXml(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      pages.push(pageText.replace(/[ \t]+\n/g, "\n").trim());
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join("\n\n");
}

export async function extractDocument(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds the 20 MB limit.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "txt" || extension === "md") return file.text();
  const bytes = await file.arrayBuffer();
  if (extension === "pdf") return extractPdfText(bytes);
  if (extension === "docx") return extractDocxText(bytes);
  throw new Error("Choose a TXT, MD, PDF, or DOCX file.");
}

export function compareDocuments(original: string, revised: string): RedlinePart[] {
  return diffWordsWithSpace(original, revised).map((part: Change) => ({
    value: part.value,
    kind: part.added ? "added" : part.removed ? "removed" : "same",
  }));
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function flagRiskyChanges(parts: RedlinePart[]): RiskFlag[] {
  const changedText = parts
    .filter((part) => part.kind !== "same")
    .map((part) => part.value)
    .join(" ");
  const contextText = parts
    .filter((part) => part.kind !== "removed")
    .map((part) => part.value)
    .join("");
  const candidateSentences = sentences(contextText).filter((sentence) =>
    changedText.split(/\s+/).some((word) => word.length > 4 && sentence.toLowerCase().includes(word.toLowerCase())),
  );

  return RISK_RULES.flatMap((rule, ruleIndex) => {
    const excerpt = candidateSentences.find((sentence) => rule.pattern.test(sentence));
    return excerpt
      ? [{
          id: `risk-${ruleIndex}`,
          label: rule.label,
          explanation: rule.explanation,
          excerpt: excerpt.slice(0, 280),
        }]
      : [];
  });
}

export function buildRedlineReport(
  originalName: string,
  revisedName: string,
  parts: RedlinePart[],
  risks: RiskFlag[],
): string {
  const additions = parts.filter((part) => part.kind === "added").map((part) => part.value.trim()).filter(Boolean);
  const removals = parts.filter((part) => part.kind === "removed").map((part) => part.value.trim()).filter(Boolean);
  const lines = [
    "# Document redline report",
    "",
    `Original: ${originalName}`,
    `Revised: ${revisedName}`,
    "",
    "> Automated comparison only. This report is not legal advice and may miss important context.",
    "",
    `## Additions (${additions.length})`,
    ...additions.map((value) => `- ${value}`),
    "",
    `## Removals (${removals.length})`,
    ...removals.map((value) => `- ${value}`),
    "",
    `## Heuristic risk flags (${risks.length})`,
    ...risks.flatMap((risk) => [`### ${risk.label}`, risk.explanation, `> ${risk.excerpt}`, ""]),
  ];
  return lines.join("\n");
}
