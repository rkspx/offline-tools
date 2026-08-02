# Batch Converter

Converts CSV columns across physical units, data units, IANA time zones, and currencies, with row-level errors and CSV export. Custom dated currency-rate files can be imported.

The bundled rates are a fixed offline snapshot dated **2026-07-31**, base USD, covering 14 currencies; they are not live market or settlement rates. DST gaps are rejected and ambiguous folds use the earlier occurrence. Numeric precision is user-configured and outputs should be reviewed.
