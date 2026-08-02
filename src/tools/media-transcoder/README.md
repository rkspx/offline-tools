# Media Transcoder

Loads the packaged FFmpeg core and WASM in a worker to convert, trim, resize, and compress local audio/video. Outputs include MP4, WebM, MP3, WAV, and M4A where the bundled codecs permit.

Files are limited to 1 GB and two hours. Processing is memory-intensive, cancellation terminates the worker, and codec/container compatibility depends on the FFmpeg build. Cross-origin isolation is required for reliable WASM operation.
