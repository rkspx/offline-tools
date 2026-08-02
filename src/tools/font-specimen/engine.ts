export type TypeToken = {
  name: string;
  step: number;
  sizeRem: number;
  sizePx: number;
};

export type FontExportOptions = {
  family: string;
  basePx: number;
  ratio: number;
  stepsBelow: number;
  stepsAbove: number;
};

const round = (value: number, places = 3) => Number(value.toFixed(places));

export function generateTypeScale(
  basePx: number,
  ratio: number,
  stepsBelow = 2,
  stepsAbove = 6,
): TypeToken[] {
  const safeBase = Math.max(1, basePx);
  const safeRatio = Math.max(1.01, ratio);
  const tokens: TypeToken[] = [];

  for (let step = -Math.max(0, stepsBelow); step <= Math.max(0, stepsAbove); step += 1) {
    const sizePx = safeBase * safeRatio ** step;
    tokens.push({
      name: step === 0 ? "base" : step < 0 ? `minus-${Math.abs(step)}` : `plus-${step}`,
      step,
      sizeRem: round(sizePx / 16),
      sizePx: round(sizePx, 2),
    });
  }

  return tokens;
}

export function toCssVariables(options: FontExportOptions): string {
  const tokens = generateTypeScale(
    options.basePx,
    options.ratio,
    options.stepsBelow,
    options.stepsAbove,
  );
  return [
    ":root {",
    `  --font-family: ${quoteFamily(options.family)};`,
    `  --type-ratio: ${round(options.ratio)};`,
    ...tokens.map((token) => `  --text-${token.name}: ${token.sizeRem}rem;`),
    "}",
  ].join("\n");
}

export function toTokenJson(options: FontExportOptions): string {
  const scale = generateTypeScale(
    options.basePx,
    options.ratio,
    options.stepsBelow,
    options.stepsAbove,
  );
  return JSON.stringify(
    {
      font: {
        family: { value: options.family, type: "fontFamily" },
        scaleRatio: { value: round(options.ratio), type: "number" },
        size: Object.fromEntries(
          scale.map((token) => [
            token.name,
            {
              value: { value: token.sizePx, unit: "pixel" },
              type: "dimension",
            },
          ]),
        ),
      },
    },
    null,
    2,
  );
}

export function fontNameFromFile(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base || "Local font";
}

function quoteFamily(family: string): string {
  const escaped = family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}
