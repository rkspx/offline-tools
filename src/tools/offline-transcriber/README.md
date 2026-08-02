# Offline Transcriber

Uses `browser-whisper` to transcribe browser-decodable audio/video locally, edit timestamped segments, build an extractive summary, and export TXT, SRT, VTT, or JSON.

A selected model (about 64–510 MB) and a small WASM runtime must be downloaded before first use; only later runs can be offline. Models may persist in OPFS. Accuracy, language coverage, WebGPU/WASM speed, and media decoding vary by browser. Files are limited to 500 MB/two hours.
