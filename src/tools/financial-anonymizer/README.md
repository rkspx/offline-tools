# Financial Anonymizer

Detects selected financial and personal identifiers in CSV text or PDF text layers, then redacts or tokenizes user-approved findings.

PDF export is flattened: every page is rasterized, redactions are painted into the image, and a new image-only PDF is created. This prevents recoverable text beneath overlays but removes selectable text, links, forms, accessibility structure, and vector sharpness. Detection is heuristic and every output must be reviewed.
