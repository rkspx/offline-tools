# Minitools

Minitools is a static, local-first React application containing 23 browser utilities for media, documents, data, design, developer work, and security triage. Files are processed in the current browser context; there is no application backend.

## Setup

Requirements:

- A current Node.js release supported by Vite 8 (Node 20.19+ or 22.12+).
- npm.
- A current Chromium-family browser for the broadest feature support.

```sh
npm install
npm run dev
```

The development server prints its local URL. Some tools need cross-origin isolation; use the Vite server instead of opening `index.html` directly.

## npm scripts

- `npm run dev` — start the Vite development server.
- `npm run build` — type-check and create the production bundle in `dist/`.
- `npm run preview` — serve the production bundle locally with the required security headers.
- `npm run typecheck` — run TypeScript project checks without emitting files.
- `npm run lint` — run ESLint.
- `npm test` — run the Vitest unit suite once.
- `npm run test:watch` — run Vitest in watch mode.
- `npm run test:e2e` — launch Vite preview and run the Playwright Chromium smoke suite.

## Static deployment

Build with `npm run build`, then publish the complete `dist/` directory. Routing uses URL hashes (`/#/tool-slug`), so the host only needs to serve `index.html` and static assets; server-side route rewrites are not required. Preserve the generated service worker and manifest paths.

Every document and subresource must be served over HTTPS in production. Configure these response headers on the HTML, JavaScript, worker, WASM, model, and media assets:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite development and preview already set both headers. A production static host must set them separately. Cross-origin assets must opt in with a suitable `Cross-Origin-Resource-Policy` header or CORS response; otherwise COEP blocks them. Do not weaken these headers if threaded WASM support is required.

Example host configuration:

- Netlify `_headers`: apply both headers to `/*`.
- Cloudflare Pages or another CDN: create equivalent response-header rules for all paths.
- nginx: use `add_header ... always` for both headers in the site location.

## Browser support

Current Chromium is the primary supported target and the browser exercised by end-to-end tests. Current Firefox and Safari can run the core file, text, data, and Canvas tools, but codec support, WebCodecs, File System Access, OPFS, cross-origin-isolated WASM, font loading, and downloadable media formats vary by browser and OS. The interface reports missing capabilities where practical. Large in-browser jobs are also constrained by device memory.

JavaScript, WebAssembly, Web Workers, IndexedDB, Web Crypto, and the File/Blob APIs must be enabled. Private browsing and storage policies can prevent persistent caches. Mobile layouts are supported, but memory-heavy media and PDF operations are best run on desktop.

## Privacy and storage model

- Imported bytes and generated output stay in the browser unless the user explicitly downloads or shares them.
- The application has no telemetry, account system, application API, or upload backend.
- The PWA service worker and browser storage may cache application assets, WASM engines, snippets, vault data, and speech models on the device.
- Clearing site data removes those caches. Export important vault files before clearing storage.
- Local-first is not the same as zero-network: the first app load fetches static assets from the deployment origin, and the transcription tool fetches its selected model/runtime when requested.
- Browser extensions, a compromised origin, modified dependencies, or a compromised device can still access data displayed in the page.

## First-run downloads

The initial visit downloads the application chunks needed for the selected route. DuckDB-Wasm, PDF.js workers, and similar runtimes are delivered as versioned app assets when their tools load. Media Transcoder loads the packaged FFmpeg core JavaScript and WASM from `/ffmpeg/` on first use; the browser may cache them.

Offline Transcriber does not bundle a speech model. The user must choose and download one: approximately 64 MB (Tiny), 136 MB (Base), 510 MB (Small), or 185 MB (Distil Small), plus a small WASM runtime. Model retrieval requires network access and the upstream model host must remain compatible with COEP/CORS. Models are cached in browser storage when OPFS is available. “Offline” describes transcription after a successful model download, not the first run.

## Tool status and limitations

All 23 registered routes render and have unit-tested engines where applicable. They remain browser utilities, not substitutes for audited professional software.

- **Media Transcoder** — FFmpeg-Wasm conversion, trimming, resolution, quality, and audio controls. Limited to 1 GB and two hours; speed, memory use, and codecs depend on the packaged FFmpeg build.
- **File Converter** — still-image conversion, image-to-PDF, PDF merge/split, and browser-decodable audio to PCM WAV. No office-document conversion, video conversion, compressed audio output, or animated-image preservation.
- **SQLite Analyzer** — DuckDB-Wasm import for CSV, JSON, JSONL, and NDJSON with bounded read-only SQL and export. Despite the historical slug, this build does not import SQLite because `sqlite_scanner` is not bundled.
- **Image Optimizer** — Canvas-based resize/compression, batch ZIPs, and Open Graph composition. Animated input is flattened; metadata and color profiles may be discarded; AVIF/WebP output is browser-dependent.
- **DevTools Studio** — local format/minify, JSONPath-like expressions, type generation, log parsing, text comparison, and browser-stored snippets. It is not a full parser, compiler, or standards-complete query engine.
- **Document Redliner** — text extraction and structural text differences for text, DOCX, and PDF, plus heuristic risk flags. Formatting/layout changes are not preserved and flags are not legal advice.
- **Offline Transcriber** — local Whisper-family transcription, recording, editable timestamps, extractive summaries, and TXT/SRT/VTT/JSON export. Requires a first-run model download; accuracy, language coverage, WebGPU/WASM speed, and decoding support vary.
- **Secrets Vault** — AES-GCM encrypted portable vault with PBKDF2 key derivation, password generation, export, and optional OPFS storage. **This vault has not been independently security-audited; do not treat it as a replacement for an audited password manager.** Forgotten master passwords cannot be recovered.
- **Financial Anonymizer** — heuristic CSV/PDF sensitive-value detection with selectable redaction or tokenization. PDF output is permanently flattened by rasterizing every page before applying redactions; selectable text, links, forms, accessibility structure, and vector quality are lost, and file size may increase. Detection can miss data, so inspect every output.
- **Spreadsheet API Mocker** — imports CSV/XLSX sheets and simulates local `GET` collection/item requests, filters, sorting, and pagination; exports a fetch helper and an OpenAPI-like description. It does not open a network port, intercept arbitrary application requests, persist mutations, implement POST/PUT/PATCH/DELETE, authentication, latency, or a standards-complete OpenAPI server.
- **Artifact Inspector** — hashes files, extracts bounded previews, and applies curated static rules without execution. It is heuristic triage, not malware detonation or antivirus.
- **Secret and PII Scanner** — scans text and bounded ZIP entries with credential, PII, entropy, and custom regex signals. It can produce false positives/negatives and is not a compliance certification.
- **YARA Playground** — parser/scanner for a documented YARA-compatible browser subset. It is not libyara and omits modules, imports, includes, external variables, loops, wildcard sets, hex jumps/ranges, PE/ELF helpers, and much of the full grammar; validate production rules with libyara.
- **Compliance Gatekeeper** — static inspection of EML, DOCX, and PDF text, links, attachment metadata, classifications, and active-content indicators. It cannot prove a document safe and does not replace policy or human review.
- **Font Specimen** — previews local font files and exports CSS/type-scale tokens. Browser font parsing and variable-font behavior vary; generated scales are design starting points.
- **Spreadsheet PII Scrubber** — infers sensitive CSV columns and supports keep, redact, hash, tokenize, and generalize transforms. Detection is heuristic, spreadsheet formulas/styles are not retained, and outputs require review.
- **Photo Metadata Scrubber** — reads common image metadata, re-encodes images through Canvas, batch renames, and exports cleaned files. Re-encoding may alter quality/color and flatten animation; uncommon metadata containers may not be reported.
- **Log Pattern Extractor** — applies built-in and custom regular expressions to local log text and exports CSV/JSON. It is line-oriented and heuristic, not a general log parser; pathological custom regexes can be expensive.
- **Audio Editor** — browser decoding, trim, fades, gain, normalization, mono conversion, simple noise-gate/high-pass processing, and PCM WAV export. Limited to 500 MB/30 minutes; there is no multitrack editing or compressed export.
- **Barcode Labeler** — CSV mapping, QR/linear barcode validation, print layout, and PDF label generation. Scanner readability depends on valid source data, print scale, media, and printer quality.
- **Structural Diff** — parses and compares JSON, YAML, or XML and supports local merge/export. XML/YAML normalization can lose presentation details such as comments, anchors, ordering intent, or formatting.
- **Palette and Contrast** — Canvas palette extraction, manual color comparison, WCAG contrast calculations, and token export. Extracted colors are sampled approximations and do not replace testing complete UI states.
- **Batch Converter** — CSV batch conversion for units, time zones, and currencies. The bundled currency snapshot is an offline reference dated **2026-07-31**, base USD, with 14 currencies; it is not live market data or suitable for settlement. Users can import their own dated JSON/CSV rates. DST gaps/folds are reported with deterministic handling.

Detailed implementation notes live in each `src/tools/<registered-slug>/README.md`.

## Security tools

The shared security scanner implements a deterministic YARA-compatible subset rather than libyara. Security, compliance, PII, and redaction results are heuristic and can miss relevant material. Never use a “no findings” result as proof of safety, legal compliance, or complete anonymization.
