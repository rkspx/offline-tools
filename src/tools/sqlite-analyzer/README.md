# Local Data Analyzer

This tool runs entirely in the browser. It imports CSV, JSON, JSONL, and NDJSON into the installed `@duckdb/duckdb-wasm` engine, then exposes a read-only SQL workspace, result table, SVG chart builder, and CSV or standalone HTML export.

## SQLite limitation

SQLite file import is intentionally not presented as supported.

DuckDB can read SQLite through its `sqlite_scanner` extension in native builds. The installed DuckDB-Wasm package does not bundle that extension or a browser-compatible SQLite reader. Loading it would require a compatible remote WASM extension at runtime and would make offline availability and browser support unreliable. The project also has no installed SQLite-Wasm fallback such as `sql.js`, and this tool is not allowed to add dependencies or change package configuration.

For that reason, `.sqlite`, `.sqlite3`, and `.db` files produce a clear error. No SQLite data is parsed or uploaded. Convert the database to CSV or JSON before importing it here.

## Safety model

- File bytes stay in the current browser tab and are registered in DuckDB's in-memory virtual file system.
- User SQL is restricted to one read-only `SELECT`, `WITH`, `DESCRIBE`, `SHOW`, `SUMMARIZE`, or `EXPLAIN` statement.
- Data-changing statements, extension management, attachment, external URLs, and file-reading table functions are blocked.
- Result rendering is limited to 10,000 rows. Export uses the same bounded result.
- Imports and queries expose cancellation controls. Closing the tool terminates its DuckDB worker.
