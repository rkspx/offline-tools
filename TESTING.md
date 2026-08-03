# Manual feature test guide

This guide covers every user-facing feature in the 23 registered Minitools routes. Unless a case says otherwise, run it in the latest Chromium release through the Vite server.

## Test setup

1. Install dependencies with `npm install`.
2. Start the app with `npm run dev` and open the printed URL. Do not open `index.html` directly.
3. Keep browser DevTools open. Treat an uncaught exception, console error, frozen interface, or unexpected request containing imported data as a failure.
4. Use synthetic data only. Never use real passwords, personal records, financial documents, or suspicious binaries for testing.
5. Save downloads to a temporary directory and inspect the downloaded file, not only the in-app preview.
6. Before release, also run:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e`

Recommended fixtures:

- Small and large JPEG/PNG/WebP images, one transparent PNG, one animated GIF, one solid-color image, and one image with EXIF GPS data.
- Short WAV/MP3 audio and MP4/WebM video with obvious start/end cues.
- Two multi-page PDFs, a text PDF, an image-only PDF, a DOCX, and an EML with a harmless attachment.
- CSV files with quoted commas, blank cells, Unicode, duplicate headers, dates, numbers, and synthetic identifiers.
- Valid and malformed JSON, JSONL, YAML, XML, ZIP, PDF, font, media, and vault files.

## Common application checks

Run these once per release:

1. Open `/`. Confirm 23 cards render, search narrows the list, category navigation works, and each card opens the correct hash route.
2. Open every `/#/<tool-slug>` route directly and refresh it. Confirm the route remains selected and no runtime error appears.
3. At 390 × 844, open the tool menu, navigate to a tool, and confirm the menu closes. Check that controls remain reachable without horizontal page scrolling.
4. Navigate using only Tab, Shift+Tab, Enter, Space, and arrow keys. Confirm visible focus, sensible order, operable file controls, and keyboard-accessible dialogs.
5. Test light and dark system themes and 200% browser zoom.
6. After the app and any explicitly requested runtime/model are loaded, disable the network and repeat a representative operation. No imported content should be uploaded.
7. Reload after clearing site data. Confirm cached snippets, models, and vault data are removed, while downloaded files remain outside browser storage.
8. Where practical, repeat core cases in current Firefox and Safari. Unsupported codecs or browser APIs should produce a clear message or disabled control, not a crash.

## 1. Media Transcoder

Route: `/#/media-transcoder`

Core features:

1. Import a short video. Confirm duration, dimensions, and audio/video details appear.
2. Convert it to MP4/H.264 and WebM/VP9. Play each download and confirm audio/video synchronization and a correct extension/MIME type.
3. Set an obvious trim range. Confirm the downloaded duration and first/last frames match the range.
4. Test “Keep source”, 1080p, 720p, and 480p maximum resolution. Confirm aspect ratio is preserved and smaller presets do not upscale.
5. Test Smaller, Balanced, and High quality. Confirm all outputs play and file-size/visual-quality changes are plausible.
6. Disable audio on a video. Confirm the result has no audio track.
7. Import audio and export MP3, M4A, and WAV. Confirm each plays; inspect WAV as PCM audio.
8. Start a long conversion, choose Cancel, and confirm processing stops, controls recover, and no partial download is offered.

Edge cases:

- Try an unsupported or corrupt file, a file over 1 GB, and media reported over two hours. Expect a bounded validation error.
- Try a codec unsupported by the packaged FFmpeg build. Expect a conversion error without losing the source selection.
- Run without cross-origin isolation. Expect a capability warning rather than a hang.
- Trim with equal/reversed bounds or outside the duration. Expect validation and no worker start.

## 2. File Converter

Route: `/#/file-converter`

Core features:

1. Under Image conversion, convert JPEG, PNG, WebP, GIF, BMP, and HEIC/HEIF where supported to JPEG and PNG.
2. Change JPEG quality from 40% to 100%. Confirm PNG disables the quality control and JPEG sizes/quality vary plausibly.
3. Convert a transparent PNG to JPEG and confirm transparent pixels become white. Convert an animated GIF and confirm a still image is produced.
4. Queue multiple images, convert them, download one result, then use Download ZIP and verify every completed output and filename.
5. Under Images to PDF, queue several images in a known order. Confirm one page per image and preserved queue order.
6. Under Merge PDFs, queue two multi-page PDFs. Confirm all pages appear in source and page order.
7. Under Split PDF, import one multi-page PDF. Confirm the ZIP contains one zero-padded PDF filename per page.
8. Under Audio to WAV, convert a browser-decodable audio file. Confirm a playable 16-bit PCM WAV.
9. Remove one queued item and use Clear. Confirm queue, progress, and stale messages reset.

Edge cases:

- Select the wrong kind of file for an operation, an office document, video, corrupt PDF, encrypted PDF, or file over 150 MB. Expect an item-level error.
- Attempt PDF merge with fewer than two valid PDFs. Expect a specific validation message.
- Select multiple files for Split PDF. Only the first should be queued and the limitation should be reported.
- Use a huge image exceeding the canvas/pixel limit or an audio codec the browser cannot decode. Expect a recoverable error.
- Mix valid and invalid batch items. Valid files should finish and remain downloadable.

## 3. SQLite Analyzer

Route: `/#/sqlite-analyzer`

Core features:

1. Import CSV with quoted commas, blank values, Unicode, dates, and numbers. Confirm a safe table name and inferred columns.
2. Import JSON array, JSONL, and NDJSON fixtures. Confirm row and column values match the sources.
3. Import multiple datasets with colliding filenames. Confirm unique table names are assigned.
4. Run `SELECT`, `WITH`, `DESCRIBE`, `SHOW`, `SUMMARIZE`, and `EXPLAIN` examples. Confirm results render and remain bounded.
5. Create both bar and line charts from categorical and numeric result columns. Confirm only numeric points are plotted, labels update, and no more than 20 points render.
6. Export CSV and standalone HTML. Open each and confirm escaping, values, and row limits.
7. Start a slow import/query and cancel it. Confirm the worker stops and the workspace recovers.

Edge cases:

- Import `.sqlite`, `.sqlite3`, or `.db`. Expect a clear unsupported message; SQLite is not parsed.
- Try `INSERT`, `UPDATE`, `DELETE`, DDL, `ATTACH`, extension commands, external URLs, file-reading functions, or multiple statements. Expect rejection before execution.
- Put blocked words inside SQL strings/comments. A valid read-only query should still run.
- Return more than 10,000 rows. Confirm display and export are capped.
- Import empty, malformed, or schema-inconsistent data. Expect a useful error and no broken table registration.

## 4. Image Optimizer

Route: `/#/image-optimizer`

Core features:

1. Add one image and test Custom plus every asset preset. Confirm width, height, format, and fit defaults update.
2. Test Contain, Cover/Crop, and Stretch using a non-square image. Confirm dimensions and visual behavior.
3. Export JPEG, PNG, WebP, and AVIF where enabled. Confirm unsupported encoders are visibly unavailable.
4. Compare 30% and 100% lossy quality. Confirm PNG disables quality and output metrics are plausible.
5. Set a Canvas background and process a transparent source. Confirm compositing is correct for opaque output.
6. Enable Color threshold removal, choose a color manually, sample it from the source preview, and vary tolerance. Confirm only near-color pixels become transparent.
7. Process multiple images, remove one item, reprocess with changed settings, download a single result, and export multiple results as ZIP.
8. Use OG Composer with title, subtitle, three colors, and optional backdrop. Confirm a 1200×630 JPEG preview/download and title wrapping of at most three lines.
9. Use Clear and confirm source/output previews and queued state are released.

Edge cases:

- Add a non-image, image over 80 MB, batch over 250 MB, corrupt image, or output over 36 MP. Expect bounded per-file/batch errors.
- Use a 1×1 image, extreme aspect ratio, width/height boundaries, and animated GIF. Confirm no crash and animation is flattened.
- Enable color removal while JPEG is selected. Expect a clear requirement to choose PNG, WebP, or AVIF.
- Leave the OG title blank. Render must remain disabled.
- Test removal tolerance 0 and 100 and a color absent from the image.

## 5. DevTools Studio

Route: `/#/devtools-studio`

Core features:

1. JSON: format/minify valid nested JSON, numbers, booleans, null, arrays, Unicode, and escaped strings. Confirm Copy writes the exact result.
2. Regex: test global/case-insensitive matches and capture groups. Confirm value, index, empty groups, and match count.
3. JSON → TypeScript: generate nested interfaces, arrays, optional-looking data, and unsafe property names with a custom root name. Review valid TypeScript output.
4. Log parser: parse mixed plain-text logs and JSON Lines. Confirm line, timestamp, level, message, and extra fields.
5. Text diff: compare added, removed, changed, blank, and unchanged lines. Confirm stable line-level markers.
6. In each tab, save a named snippet, change the input, reload the snippet, refresh the page, and confirm persistence.
7. Confirm snippets are scoped to their tab and Clear removes only the active tab’s snippets.

Edge cases:

- Submit malformed/empty JSON and invalid root type names. Expect a visible error and no stale result.
- Test invalid/duplicate regex flags, invalid syntax, zero-length matches, and a risky nested-repetition pattern. Expect validation or bounded completion.
- Parse blank lines, malformed JSONL, and logs without timestamps/levels.
- Test the 200,000-character input bound, a regex over 500 characters, more than 500 matches, and more than 2,000 log lines. Expect bounded output or a clear validation error.
- Deny clipboard permission. The app should not crash and should not falsely report success.
- Clear site data and confirm saved snippets disappear.

## 6. Document Redliner

Route: `/#/document-redliner`

Core features:

1. Compare two plain-text files with insertions, deletions, punctuation, Unicode, paragraphs, and line breaks.
2. Compare DOCX documents containing paragraphs, tabs, and explicit breaks. Confirm extracted text and word-level differences.
3. Compare text-layer PDFs. Confirm text extraction and differences are usable.
4. Introduce each supported risky phrase only in the changed version. Confirm it is flagged; existing phrases should not be reported as newly introduced.
5. Review additions/removals and export `redline-report.md`. Open it and confirm source names, additions, removals, risk flags, and the non-advice disclaimer.

Edge cases:

- Use identical documents, empty documents, image-only PDF, malformed DOCX/PDF, and a file over 20 MB.
- Compare documents with formatting-only changes. Expect no structural formatting diff.
- Include HTML/script-like text. It must render/export as text, never execute.
- Rapidly replace a file during extraction. The final comparison must correspond to the visible selected files.

## 7. Offline Transcriber

Route: `/#/offline-transcriber`

Core features:

1. Review capability notices, choose each model size, download one model, reload, and confirm cached availability where OPFS is supported.
2. Clear the model cache and confirm transcription requires a model again.
3. Import short speech audio/video and test Auto Detect plus an explicit supported language.
4. Record a short microphone sample, stop recording, and transcribe it. Confirm permission and recording states are clear.
5. Run transcription, observe progress, cancel a second run, and confirm controls recover.
6. Edit segment text/timestamps. Confirm the transcript and all subsequent exports use the edits.
7. Search the transcript and confirm only matching timestamped segments remain visible without changing the exported transcript.
8. Generate the extractive summary. Confirm selected sentences remain in source order.
9. Export TXT, SRT, VTT, and JSON. Validate cue ordering, timestamp syntax, no rounding into the next cue, and JSON fields.
10. Disable network after model download and repeat a transcription.

Edge cases:

- Deny microphone permission, run without WebAssembly, remove network before first model download, or simulate an unavailable/CORS-blocked model host.
- Import unsupported/corrupt media, silence, no-speech audio, file over 500 MB, or media over two hours.
- Test overlapping, zero-length, reversed, and hour-long edited timestamps; invalid edits should be rejected or normalized clearly.
- Test a browser without OPFS/WebGPU. Expect a documented fallback or capability message.
- Leave microphone recording active and verify it stops at the 30-minute recording limit.
- Choose Distil Small with a non-English language and confirm the English-only limitation is clear.

## 8. Secrets Vault

Route: `/#/secrets-vault`

Core features:

1. Create a vault with a 12+ character master password. Confirm mismatched confirmation is rejected.
2. Add, edit, and delete entries covering title, username, password, URL, notes, and Unicode. Confirm title is required and deletion asks for confirmation.
3. Search by title, username, URL, and notes. Confirm passwords are not searchable or exposed in the list.
4. Reveal/hide and copy a password. Confirm masked display and the best-effort 30-second clipboard-clear notice.
5. Generate several passwords in the sidebar and entry editor. Confirm values change and can be copied.
6. Encrypt changes, export the vault, lock it, re-import it, and unlock with the correct password. Confirm all fields round-trip.
7. Save in browser and load the browser-saved vault where OPFS is available.
8. Lock manually and verify plaintext disappears. Leave it inactive for five minutes and confirm auto-lock.

Edge cases:

- Try a short password, wrong password, malformed JSON, unsupported vault version, truncated file, and one-byte ciphertext corruption. Errors must not distinguish wrong password from damaged authenticated data.
- Export twice after separate saves. Confirm plaintext is absent and ciphertext differs because every save uses a fresh IV; newly created vaults should also use different salts.
- Deny clipboard access or OPFS storage. Expect a recoverable message.
- Close/reload with unsaved in-memory changes. Confirm they do not silently appear as encrypted saved data.
- Clear site data and confirm OPFS vault removal; verify an exported backup still imports.

## 9. Financial Anonymizer

Route: `/#/financial-anonymizer`

Core features:

1. Import CSV containing synthetic names, emails, phones, account/routing numbers, tax identifiers, and valid card numbers.
2. Review finding type/location/evidence, toggle individual findings, use Select all and Clear, and confirm only selected values change.
3. Export in Redact mode. Confirm selected cells are replaced while quoting, unrelated cells, and row/column structure remain intact.
4. Export in Tokenize mode twice in one run. Confirm repeated values map consistently and unselected values remain unchanged.
5. Import a text-layer PDF, select findings, and export. Confirm every page is rasterized and redaction pixels permanently replace selected text.

Edge cases:

- Use a card-like number with an invalid Luhn checksum. It should not be classified as a card.
- Test quoted commas, multiline CSV fields, blank rows, duplicate values, Unicode, and values split across fields.
- Import image-only, encrypted, malformed, over-25-MB, or over-100-page PDFs. Expect missing-text or bounded errors; pages over 18 million raster pixels must be rejected safely.
- Search the exported PDF bytes/text extraction for the original selected value. It must not remain recoverable.
- Confirm unselected sensitive findings remain visible and the UI warns that human review is required.

## 10. Spreadsheet API Mocker

Route: `/#/spreadsheet-api-mocker`

Core features:

1. Import CSV and XLSX with multiple sheets. Select a sheet and confirm headers, inferred booleans/numbers/nulls/strings, route name, and row preview.
2. Issue a collection GET and an item GET by ID. Confirm response status/body and missing-item behavior.
3. Test equality, range, and string filters individually and combined.
4. Test ascending/descending multi-field sorting, including equal values and blanks.
5. Test page/page-size boundaries and confirm a collection response never exceeds 500 rows.
6. Use the in-page `mockFetch` helper with supported and unknown routes.
7. Copy the fetch example and OpenAPI-like JSON. Confirm clipboard contents and route/schema examples match the imported data.
8. Reload and confirm the configured collection route, ID field, and selected sheet persist in local storage.

Edge cases:

- Import an empty sheet, duplicate/blank headers, duplicate IDs, missing IDs, quoted CSV, mixed types, formulas, and Unicode.
- Request an invalid route, method other than GET, malformed filter/range, unknown field, page 0/negative, and excessive page size.
- Confirm the tool does not open a network port or intercept unrelated browser requests.
- Reload and confirm no unsupported mutations or server persistence are implied.

## 11. Artifact Inspector

Route: `/#/artifact-inspector`

Core features:

1. Import harmless text, image, PDF, ZIP, and synthetic binary fixtures. Confirm filename, size, type, SHA-256, hex preview, and bounded text preview.
2. Verify the SHA-256 independently with a local trusted utility.
3. Test files with known harmless signatures such as `MZ` header text and command-indicator strings. Confirm curated static findings and rule metadata.
4. Export JSON and HTML reports. Confirm hashes, findings, previews, escaping, and local-only disclaimer.

Edge cases:

- Import empty, extensionless, MIME-mislabeled, high-entropy, corrupt, and over-20-MB files.
- Include HTML/script bytes and invalid UTF-8. Preview/report must not execute content.
- Rename the same bytes to a different extension. Hash must remain identical; type interpretation may change transparently.
- Confirm no imported artifact is executed and “no findings” is not presented as proof of safety.

## 12. Secret and PII Scanner

Route: `/#/leak-scanner`

Core features:

1. Scan pasted synthetic API keys, tokens, emails, phones, IPs, valid cards, and high-entropy strings.
2. Confirm evidence is masked, severities/counts are correct, and All/High/Medium/Low filters work.
3. Scan supported local text files and a ZIP containing several text entries. Confirm source names and finding counts.
4. Add, edit, disable, and remove custom regex rules; test each severity.
5. Export JSON and HTML. Confirm masked evidence, source attribution, escaping, and no plaintext secret leakage.

Edge cases:

- Use an invalid-Luhn card number, low-entropy placeholder, split/encoded secret, duplicate finding, Unicode, binary file, nested ZIP, encrypted ZIP, file over 20 MB, ZIP over 20 MB compressed, over 250 entries, or over 40 MB expanded.
- Enter invalid or expensive custom regex syntax. Expect validation/bounds rather than a frozen page.
- Produce more than 5,000 candidate findings and confirm the scan is capped.
- Include script-like source text and archive filenames. Report output must not execute it.
- Run a no-findings scan and confirm it is not described as compliance certification.

## 13. YARA Playground

Route: `/#/yara-playground`

Core features:

1. Create rules with names, tags, primitive metadata, text strings, hex strings, and regex strings.
2. Test `ascii`, `wide`, `nocase`, and `fullword` against matching and near-matching samples.
3. Test boolean string references and `any`, `all`, and numeric “N of them” conditions.
4. Test `filesize` and little-endian `uint8`, `uint16`, and `uint32(offset)` comparisons.
5. Scan pasted/sample bytes and local files. Confirm matched rules, strings, offsets, tags, and metadata.
6. Profile several rules and confirm parse/scan timing and match counts remain associated with the correct rule.

Edge cases:

- Test unknown string references, malformed declarations, invalid regex/hex, out-of-range uint reads, empty file, over-20-MB file, and binary/wide boundaries.
- Scan a binary whose decoded editor preview exceeds 200,000 characters. Confirm the preview is truncated while scanning still uses the bounded source bytes.
- Try unsupported imports/modules, includes, external variables, loops, wildcard sets, hex jumps/ranges, and PE/ELF helpers. Expect explicit parser errors, not partial silent acceptance.
- Test `fullword` beside ASCII punctuation, letters, digits, underscores, and wide characters.
- Compare representative supported rules with libyara, while recognizing this tool is only a subset.

## 14. Compliance Gatekeeper

Route: `/#/compliance-gatekeeper`

Core features:

1. Inspect EML, DOCX, and text-layer PDF fixtures. Confirm summary and Findings, Attachments, Links, and Text tabs.
2. Use classification terms at different levels and confirm expected static findings.
3. Add harmless suspicious-link forms, mismatched-looking labels, and double-extension attachment names. Confirm detection and source context.
4. Use a DOCX fixture with macro/active-content metadata and an EML with attachment headers. Confirm indicators appear without execution.
5. Export JSON and HTML. Confirm all tab data, escaped content, and human-review disclaimer.

Edge cases:

- Inspect image-only/encrypted/corrupt documents, over-20-MB files, PDFs over 200 pages, malformed EML headers, nested or encoded attachment names, Unicode domains, and missing text.
- Use text longer than the 12,000-character preview bound and confirm analysis completes while only the preview is truncated.
- Include script-like text, links, and filenames. They must not execute in the app or report.
- Confirm attachments are never rendered or executed and sender identity is not claimed as verified.
- A clean document must be reported as having no detected indicators, not proven safe/compliant.

## 15. Font Specimen

Route: `/#/font-specimen`

Core features:

1. Load supported local font files and confirm readable inferred names and visible font-list entries.
2. Load multiple fonts, switch display/body families, and remove one. Confirm previews update and object resources are released.
3. Edit specimen text and test size, line height, weight, and available font behavior.
4. Review the pairing preview at desktop/mobile widths.
5. Test each modular scale ratio and several base sizes. Confirm ordered, plausible scale values.
6. Copy CSS and Figma-style JSON design tokens. Confirm family names, sizes, line heights, valid escaping, and the exact clipboard contents.

Edge cases:

- Load a corrupt file, unsupported format, duplicate font, font with unusual/Unicode filename, and very long family name.
- Test base size/range limits, invalid numeric input, extreme line height, and unavailable weight.
- Compare a variable font and static font across browsers; unsupported axes should degrade clearly.
- Confirm loading a font does not imply a webfont license.

## 16. Spreadsheet PII Scrubber

Route: `/#/pii-scrubber`

Core features:

1. Paste and import CSV with synthetic names, emails, phones, IPs, dates of birth, account/card-like values, and benign columns.
2. Confirm inferred sensitive columns use both headers and sampled values; manually override every column action.
3. Test Keep, Redact, salted Hash, Tokenize, and Generalize.
4. Confirm repeated values receive deterministic tokens within the session and hashes do not expose originals.
5. Preview transformed rows and export CSV. Re-import it and confirm quoting, row count, columns, and transformed values.

Edge cases:

- Test malformed CSV, duplicate/blank headers, quoted commas/newlines, empty cells, mixed types, Unicode, and values beyond the inference sample.
- Generalize short names, malformed emails/phones, dates, and identifiers. Output must not reveal the full source.
- Run Hash twice with different sessions/salts. Outputs should differ while same-session repeated values agree.
- Import XLSX and confirm the CSV-only limitation is clear rather than silently losing workbook features.

## 17. Photo Metadata Scrubber

Route: `/#/metadata-scrubber`

Core features:

1. Import images containing EXIF date, camera, orientation, and GPS. Confirm normalized metadata and explicit GPS visibility.
2. Re-encode a cleaned image, download the generated ZIP, extract it, and re-import the image. Verify reported metadata/GPS are gone.
3. Test available output formats and quality settings. Confirm transparency and dimensions behave as indicated.
4. Configure batch rename templates, including sequence and original-name fields. Confirm filenames are safe and deterministic.
5. Process multiple images and inspect ZIP contents and filenames.

Edge cases:

- Test HEIC by MIME and by extension, animated GIF, corrupt image, unsupported format, no-metadata image, unusual metadata container, Unicode filename, and duplicate generated names.
- Use template path separators, traversal text, reserved characters, and an empty template. Filenames must remain safe.
- Compare orientation and colors before/after; no unexpected rotation should occur and documented re-encoding differences are acceptable.
- Confirm uncommon unreported metadata is not claimed to be removed without verification.

## 18. Log Pattern Extractor

Route: `/#/log-pattern-extractor`

Core features:

1. Paste logs containing built-in timestamps, levels, IPs, UUIDs, emails, URLs, request IDs, durations, and status codes.
2. Enable/disable built-in detections and confirm preview columns/counts change.
3. Add a named custom regex with a capture group, set flags, enable/disable it, and remove it.
4. Include a multiline stack trace. Confirm continuation frames join the associated error as supported.
5. Clear input and confirm stale rows disappear.
6. Export CSV and JSON with custom fields. Confirm escaping, row order, and predictable columns.

Edge cases:

- Test empty input, CRLF/LF, input over 300,000 characters, more than 3,000 source lines, huge lines, malformed Unicode, unsupported regex flags, invalid syntax, a pattern over 500 characters, no capture group, duplicate rule names, and unsafe nested repetition.
- Test multiline events that are not stack traces and confirm the line-oriented limitation is visible.
- Include spreadsheet-formula prefixes in exported values and inspect handling before opening CSV in spreadsheet software.
- Use script-like log content. It must render as text.

## 19. Audio Editor

Route: `/#/audio-editor`

Core features:

1. Import browser-decodable mono and stereo audio. Confirm waveform, sample rate, channel count, and duration.
2. Drag a waveform selection and edit start/end controls. Confirm selection is bounded; Select all restores the full range.
3. Test selection trimming, Remove silence, Silence threshold, Noise gate, Compressor, Low/Mid/High EQ, and Peak normalize separately.
4. Test meaningful combinations and confirm the cleanup chain runs in the displayed order in its worker.
5. Compare Before and After playback, then export WAV. Confirm a valid 16-bit PCM header, selected/processed duration, channel count, and playable audio.

Edge cases:

- Select zero length, reversed bounds, beyond-duration bounds, one-sample ranges, and a selection under 0.05 seconds.
- Import silence, clipped audio, very low signal, NaN-like malformed samples, unsupported/corrupt codec, file over 500 MB, or duration over 30 minutes.
- Normalize silence and apply extreme EQ/gate values. Output must not contain invalid samples or crash.
- Test cancellation/navigation during processing and repeated Apply effects clicks.

## 20. Barcode Labeler

Route: `/#/barcode-labeler`

Core features:

1. Import CSV and map columns to barcode value and visible label text.
2. Generate QR, Code 128, Code 39, EAN-13, EAN-8, UPC-A, and Interleaved 2 of 5 using valid example values.
3. Confirm check-digit validation for formats that require it.
4. Configure page size, margins, rows/columns, label dimensions, gaps, padding/quiet zone, and text options.
5. Preview multiple pages and verify deterministic sheet positions and source-row order.
6. Export PDF, print at 100% scale, and scan representative first/middle/last labels with real hardware.

Edge cases:

- Test blank values, unsupported characters, invalid lengths/check digits, very long QR data, Unicode QR data, duplicate values, and more rows than one page.
- Test impossible/negative/zero sheet geometry and labels extending beyond the page. Expect validation and no PDF.
- Use tiny labels/quiet zones and confirm a readability warning or failed physical scan is treated as fixture/layout failure, not guaranteed readability.
- Test quoted CSV fields, missing mapped column, duplicate headers, and empty file.

## 21. Structural Diff

Route: `/#/structural-diff`

Core features:

1. Compare JSON, YAML, and XML pairs with nested objects/maps, arrays/lists, attributes, scalars, nulls, and Unicode.
2. Confirm added, removed, changed, and type-changed paths and old/new values.
3. Switch between Changes and Merged tree views.
4. Choose Left/Right for individual changes, then use All left and All right. Confirm neither original input mutates.
5. Load both sides from files and change each side’s format selector.
6. Export merged output as JSON, YAML, and XML; parse each export again and verify the chosen structure.

Edge cases:

- Test malformed input, empty documents, identical structures, root type changes, deeply nested data, large arrays, duplicate XML elements, namespaces, YAML anchors/aliases, comments, and XML attributes.
- Confirm comments, anchors, formatting, and attribute order may be normalized rather than falsely shown as preserved.
- Use keys containing dots, brackets, slashes, or empty strings and confirm paths remain distinguishable.
- Switch formats after making merge choices; stale choices must not apply to unrelated paths.

## 22. Palette and Contrast

Route: `/#/palette-checker`

Core features:

1. Import a simple image with known solid color blocks. Confirm representative palette extraction, percentages, and deterministic ordering.
2. Move the Colors slider from 3 through 10. Confirm the existing sampled pixels are reclustered and the palette count/status updates.
3. Set foreground/background with extracted Fg/Bg shortcuts, color pickers, and seven-character hex fields. Verify the contrast ratio against an independent WCAG calculator.
4. Confirm AA/AAA results for normal and large text at threshold boundaries.
5. Review the text preview after swapping foreground/background.
6. Copy CSS custom properties, Tailwind-style values, and Figma-style JSON. Confirm normalized values, stable token names, and clipboard contents.

Edge cases:

- Test black/white, identical colors (1:1), values just above/below 3:1, 4.5:1, and 7:1, lowercase/uppercase hex, incomplete hex, and invalid hex characters.
- Import transparent, gradient, one-pixel, monochrome, very large, animated, and color-profiled images.
- Extract more colors than unique source colors and confirm no crash or misleading invented precision.
- Confirm pairwise results do not claim coverage of hover/focus/transparency or full UI accessibility.

## 23. Batch Converter

Route: `/#/batch-converter`

Core features:

1. Paste and import CSV with quoted values, blanks, Unicode, and several source columns.
2. Add, edit, and remove multiple independent column mappings.
3. Test length, mass, temperature, volume, speed, and data units in both directions, including negative and decimal values.
4. Test decimal/binary data-unit conversions and configured numeric precision.
5. Convert IANA time zones using ordinary dates and dates around DST transitions.
6. Convert every bundled currency through the 2026-07-31 base-USD snapshot and verify sample math independently.
7. Import valid custom JSON and CSV rate snapshots with a visible date/base, then repeat currency conversion.
8. Run a CSV with mixed valid/invalid rows. Confirm valid outputs remain and row-level errors identify failures.
9. Export CSV and re-import it to confirm quoting, columns, values, and error information.

Edge cases:

- Test unknown units/currencies/time zones, incompatible dimensions, blank/nonnumeric/NaN/infinite values, huge magnitudes, negative currency, and precision boundaries.
- Test a DST gap; it must be rejected. Test an ambiguous fold; it must choose the earlier occurrence deterministically.
- Import malformed, missing-base, duplicate, zero, negative, or nonnumeric currency rates. Expect validation.
- Confirm bundled rates are labeled offline and dated, never described as live or settlement rates.

## Release sign-off

A release passes when:

- Every core case succeeds in current Chromium.
- Every edge case fails safely with a useful message or documented browser limitation.
- Imported bytes and generated sensitive content are not sent to an application backend.
- Downloads open in an independent viewer/parser and contain the expected data.
- No test produces an uncaught exception, persistent busy state, inaccessible blocking dialog, or unrecoverable route.
- Automated typecheck, lint, unit, build, and Playwright suites pass.
