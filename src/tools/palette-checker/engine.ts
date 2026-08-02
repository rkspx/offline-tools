export type RGB = readonly [number, number, number];

export type PaletteColor = {
  rgb: RGB;
  hex: string;
  population: number;
  percentage: number;
};

export type ContrastResult = {
  ratio: number;
  normalAA: boolean;
  normalAAA: boolean;
  largeAA: boolean;
  largeAAA: boolean;
};

const distanceSquared = (a: RGB, b: RGB) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function hexToRgb(hex: string): RGB | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: RGB, b: RGB): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

export function checkContrast(foreground: RGB, background: RGB): ContrastResult {
  const ratio = contrastRatio(foreground, background);
  return {
    ratio: Number(ratio.toFixed(2)),
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7,
    largeAA: ratio >= 3,
    largeAAA: ratio >= 4.5,
  };
}

export function dominantColors(pixels: readonly RGB[], requestedClusters = 6): PaletteColor[] {
  if (pixels.length === 0) return [];
  const unique = deduplicatePixels(pixels);
  const clusterCount = Math.max(1, Math.min(Math.round(requestedClusters), unique.length));
  let centroids = seedCentroids(unique, clusterCount);
  const assignments = new Uint16Array(pixels.length);

  for (let iteration = 0; iteration < 18; iteration += 1) {
    const sums = Array.from(
      { length: clusterCount },
      (): [number, number, number, number] => [0, 0, 0, 0],
    );
    let changed = false;
    for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
      const pixel = pixels[pixelIndex];
      if (!pixel) continue;
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, centroidIndex) => {
        const distance = distanceSquared(pixel, centroid);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = centroidIndex;
        }
      });
      if (assignments[pixelIndex] !== nearest) changed = true;
      assignments[pixelIndex] = nearest;
      const sum = sums[nearest];
      if (sum) {
        sum[0] += pixel[0];
        sum[1] += pixel[1];
        sum[2] += pixel[2];
        sum[3] += 1;
      }
    }

    const next = centroids.map((centroid, index): RGB => {
      const sum = sums[index];
      if (!sum || sum[3] === 0) return centroid;
      return [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    });
    const stable = next.every((centroid, index) => distanceSquared(centroid, centroids[index] ?? centroid) < 0.5);
    centroids = next;
    if (!changed || stable) break;
  }

  const populations = new Array<number>(clusterCount).fill(0);
  assignments.forEach((assignment) => {
    populations[assignment] = (populations[assignment] ?? 0) + 1;
  });

  return centroids
    .map((rgb, index): PaletteColor => {
      const rounded: RGB = rgb.map(clampChannel) as [number, number, number];
      const population = populations[index] ?? 0;
      return {
        rgb: rounded,
        hex: rgbToHex(rounded),
        population,
        percentage: Number(((population / pixels.length) * 100).toFixed(1)),
      };
    })
    .filter((color) => color.population > 0)
    .sort((a, b) => b.population - a.population || a.hex.localeCompare(b.hex));
}

export function paletteToCss(colors: readonly PaletteColor[]): string {
  return [":root {", ...colors.map((color, index) => `  --color-${index + 1}: ${color.hex};`), "}"].join("\n");
}

export function paletteToTailwind(colors: readonly PaletteColor[]): string {
  const entries = colors.map((color, index) => `        ${index + 1}: "${color.hex}",`).join("\n");
  return `/** @type {import('tailwindcss').Config} */\nexport default {\n  theme: {\n    extend: {\n      colors: {\n        palette: {\n${entries}\n        },\n      },\n    },\n  },\n};`;
}

export function paletteToJson(colors: readonly PaletteColor[]): string {
  return JSON.stringify(
    {
      color: Object.fromEntries(
        colors.map((color, index) => [
          `palette-${index + 1}`,
          { value: color.hex, type: "color", description: `${color.percentage}% of sampled image` },
        ]),
      ),
    },
    null,
    2,
  );
}

function deduplicatePixels(pixels: readonly RGB[]): RGB[] {
  const seen = new Map<string, RGB>();
  for (const pixel of pixels) {
    const quantized: RGB = [
      Math.round(pixel[0] / 8) * 8,
      Math.round(pixel[1] / 8) * 8,
      Math.round(pixel[2] / 8) * 8,
    ];
    seen.set(quantized.join(","), pixel);
  }
  return [...seen.values()];
}

function seedCentroids(pixels: readonly RGB[], count: number): RGB[] {
  const sorted = [...pixels].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  const first = sorted[0];
  if (!first) return [];
  const centroids: RGB[] = [first];
  while (centroids.length < count) {
    let candidate = sorted[0] ?? first;
    let bestDistance = -1;
    for (const pixel of sorted) {
      const distance = Math.min(...centroids.map((centroid) => distanceSquared(pixel, centroid)));
      if (distance > bestDistance) {
        bestDistance = distance;
        candidate = pixel;
      }
    }
    centroids.push(candidate);
  }
  return centroids;
}
