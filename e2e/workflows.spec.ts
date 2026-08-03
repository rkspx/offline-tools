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

test("every tool opens through the product UI and exposes controls", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto("/");

  for (const [slug, title] of tools) {
    await page.locator(".tool-card", { hasText: title }).click();
    await expect(page).toHaveURL(new RegExp(`#/${slug}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator(".tool-workspace").locator("button, input, textarea, select").first()).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Useful work stays on your device." })).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("initial tool loading remains same-origin and cross-origin isolated", async ({ page }) => {
  const thirdPartyRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== "http://127.0.0.1:4173") {
      thirdPartyRequests.push(request.url());
    }
  });

  const response = await page.goto("/");
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["cross-origin-embedder-policy"]).toBe("require-corp");

  for (const [slug, title] of tools) {
    await page.goto(`/#/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Preparing this local tool.")).toBeHidden();
  }

  expect(thirdPartyRequests).toEqual([]);
});

test("DevTools Studio formats valid JSON and rejects invalid JSON", async ({ page }) => {
  await page.goto("/#/devtools-studio");
  const input = page.getByLabel("JSON input");

  await input.fill('{"project":"minitools","count":23}');
  await page.getByRole("button", { name: "Format & validate" }).click();
  await expect(page.getByLabel("JSON result")).toHaveValue(
    '{\n  "project": "minitools",\n  "count": 23\n}',
  );

  await input.fill("{invalid");
  await page.getByRole("button", { name: "Format & validate" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("JSON result")).toHaveCount(0);
});

test("Secret and PII Scanner finds signals without exposing the secret", async ({ page }) => {
  await page.goto("/#/leak-scanner");
  const secret = "supersecretvalue";
  await page.getByPlaceholder("Paste source code, logs, configuration, or text…").fill(
    `api_key=${secret}\nuser=test@example.com`,
  );
  await page.getByRole("button", { name: "Scan pasted text" }).click();

  await expect(page.getByText(/2 across 1 source/)).toBeVisible();
  await expect(page.getByText("Secret-like assignment")).toBeVisible();
  await expect(page.getByText("Email address")).toBeVisible();
  await expect(page.locator(".leak-results")).not.toContainText(secret);
});

test("YARA Playground validates and matches its sample rule", async ({ page }) => {
  await page.goto("/#/yara-playground");
  await expect(page.getByText(/\d+ rules valid/)).toBeVisible();
  await page.getByRole("button", { name: "Run rules" }).click();

  await expect(page.locator(".yara-rule-results article.matched").first()).toBeVisible();
  await expect(page.locator(".yara-rule-results")).toContainText("MATCH");
  await expect(page.locator(".yara-rule-results")).toContainText("Suspicious_PowerShell");
});

test("Structural Diff applies an all-right merge choice", async ({ page }) => {
  await page.goto("/#/structural-diff");
  await page.getByLabel("Original format").selectOption("json");
  await page.getByLabel("Incoming format").selectOption("json");
  await page.getByLabel("Original document").fill('{"name":"old","remove":true}');
  await page.getByLabel("Incoming document").fill('{"name":"new","add":1}');

  await expect(page.locator(".sd-summary")).toContainText("3changes");
  await page.getByRole("button", { name: "All right" }).click();
  await page.getByRole("button", { name: "Tree" }).click();

  const tree = page.getByRole("region", { name: "Merged tree" });
  await expect(tree).toContainText("new");
  await expect(tree).toContainText("add");
  await expect(tree).not.toContainText("remove");
});

test("Batch Converter recalculates an edited CSV", async ({ page }) => {
  await page.goto("/#/batch-converter");
  await page.getByLabel("CSV data").fill("distance_km,route\n1,Test route");

  await expect(page.getByText("1 rows, 2 columns")).toBeVisible();
  await expect(page.locator(".bc-preview table")).toContainText("distance_mi");
  await expect(page.locator(".bc-preview table")).toContainText("0.621371");
  await expect(page.getByText("All rows converted")).toBeVisible();
});

test("Secrets Vault creates an encrypted vault and stores a masked entry", async ({ page }) => {
  await page.goto("/#/secrets-vault");
  const password = "correct horse battery staple";

  await page.getByLabel("Master password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create encrypted vault" }).click();
  await expect(page.getByText("Your vault is empty")).toBeVisible();

  await page.getByRole("button", { name: "Add entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a secret" });
  await dialog.getByLabel("Title").fill("Example account");
  await dialog.getByLabel("Username or email").fill("test@example.com");
  await dialog.getByLabel("Password").fill("entry-secret");
  await dialog.getByRole("button", { name: "Save entry" }).click();

  await expect(page.getByRole("region", { name: "Vault entries" })).toContainText("Example account");
  await expect(page.getByRole("region", { name: "Vault entries" })).toContainText("••••••••••••");
  await expect(page.getByRole("region", { name: "Vault entries" })).not.toContainText("entry-secret");
});
