import { expect, test, type Page } from "@playwright/test";

const tools = [
  ["media-transcoder", "Media Transcoder"],
  ["file-converter", "File Converter"],
  ["sqlite-analyzer", "SQLite Analyzer"],
  ["image-optimizer", "Image Optimizer"],
  ["devtools-studio", "DevTools Studio"],
  ["document-redliner", "Document Redliner"],
  ["offline-transcriber", "Offline Transcriber"],
  ["secrets-vault", "Secrets Vault"],
  ["financial-anonymizer", "Financial Anonymizer"],
  ["spreadsheet-api-mocker", "Spreadsheet API Mocker"],
  ["artifact-inspector", "Artifact Inspector"],
  ["leak-scanner", "Secret and PII Scanner"],
  ["yara-playground", "YARA Playground"],
  ["compliance-gatekeeper", "Compliance Gatekeeper"],
  ["font-specimen", "Font Specimen"],
  ["pii-scrubber", "Spreadsheet PII Scrubber"],
  ["metadata-scrubber", "Photo Metadata Scrubber"],
  ["log-pattern-extractor", "Log Pattern Extractor"],
  ["audio-editor", "Audio Editor"],
  ["barcode-labeler", "Barcode Labeler"],
  ["structural-diff", "Structural Diff"],
  ["palette-checker", "Palette and Contrast"],
  ["batch-converter", "Batch Converter"],
] as const;

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test("home renders without runtime errors", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Useful work stays on your device." })).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(23);
  expect(errors).toEqual([]);
});

for (const [slug, title] of tools) {
  test(`${title} route renders`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto(`/#/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Preparing this local tool.")).toBeHidden();
    await expect(page.locator(".tool-workspace > *").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("search filters tools and navigation updates the route", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search tools" }).fill("yara");
  const links = page.getByRole("navigation", { name: "Tools" }).getByRole("link");
  await expect(links).toHaveCount(1);
  await links.first().click();
  await expect(page).toHaveURL(/#\/yara-playground$/);
  await expect(page.getByRole("heading", { level: 1, name: "YARA Playground" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keyboard tab reaches a visible interactive control", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  await expect(focused).toHaveAttribute("href", "#/");
});

test("mobile navigation opens and reaches a tool", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Toggle tool navigation" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Tools" }).getByRole("link", { name: /Media Transcoder/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Media Transcoder" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test.describe("system theme", () => {
  test.use({ colorScheme: "dark" });

  test("inherits the system dark color scheme", async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto("/");
    const prefersDark = await page.evaluate<boolean>(
      "matchMedia('(prefers-color-scheme: dark)').matches",
    );
    expect(prefersDark).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
