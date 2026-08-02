# Photo Metadata Scrubber

Reads common image metadata with `exifr`, re-encodes images through Canvas to remove embedded metadata, optionally changes format/quality, batch-renames files, and creates ZIP output.

Re-encoding may change quality, color, transparency, or file size and flattens animation. Browser decoding/output support varies, and uncommon or container-level metadata may not be reported. Verify exported files before publishing.
