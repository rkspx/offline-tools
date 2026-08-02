# Spreadsheet PII Scrubber

Parses CSV data, infers sensitive columns, and applies keep, redact, salted hash, tokenize, or generalize transforms before CSV export.

Inference uses names and sampled values, so it can miss sensitive columns or flag benign ones. This is CSV-oriented: workbook formulas, formatting, charts, and multiple sheets are not retained. Review transformed rows before sharing.
