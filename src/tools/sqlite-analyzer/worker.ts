import * as duckdb from "@duckdb/duckdb-wasm";
import { Table } from "apache-arrow";
import duckdbEhWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbMvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import {
  safeTableName,
  validateReadOnlySql,
  type CellValue,
  type QueryResult,
  type TableInfo,
} from "./engine";

const bundles: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbMvpWasm, mainWorker: duckdbMvpWorker },
  eh: { mainModule: duckdbEhWasm, mainWorker: duckdbEhWorker },
};

const MAX_RESULT_ROWS = 10_000;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  try {
    const serialized = JSON.stringify(value, (_key: string, nested: unknown) => typeof nested === "bigint" ? nested.toString() : nested);
    return serialized;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function tableToResult(table: Table, elapsedMs: number): QueryResult {
  const columns = table.schema.fields.map((field) => field.name);
  const sourceRows = table.toArray() as unknown[];
  const truncated = sourceRows.length > MAX_RESULT_ROWS;
  const rows = sourceRows.slice(0, MAX_RESULT_ROWS).map((row) => {
    const record = isRecord(row) ? row : {};
    return columns.map((column) => cellValue(record[column]));
  });
  return { columns, rows, elapsedMs, truncated };
}

async function readFile(
  file: File,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException("Import cancelled.", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(file.size ? Math.min(95, Math.round((received / file.size) * 95)) : 50);
  }
  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class DuckDbAnalyzer {
  private database: duckdb.AsyncDuckDB | null = null;
  private connection: duckdb.AsyncDuckDBConnection | null = null;
  private tableNames: string[] = [];

  async initialize(): Promise<void> {
    if (this.connection) return;
    const selected = await duckdb.selectBundle(bundles);
    if (!selected.mainWorker) throw new Error("No compatible DuckDB worker is available in this browser.");
    const dbWorker = new Worker(selected.mainWorker);
    const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), dbWorker);
    await database.instantiate(selected.mainModule, selected.pthreadWorker);
    this.database = database;
    this.connection = await database.connect();
  }

  async importFile(
    file: File,
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<{ tableName: string; tables: TableInfo[] }> {
    await this.initialize();
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "sqlite" || extension === "sqlite3" || extension === "db") {
      throw new Error("SQLite files are not available in this browser build. Import CSV or JSON instead.");
    }
    if (extension !== "csv" && extension !== "json" && extension !== "jsonl" && extension !== "ndjson") {
      throw new Error("Choose a .csv, .json, .jsonl, or .ndjson file.");
    }
    const tableName = safeTableName(file.name, this.tableNames);
    const virtualName = `${crypto.randomUUID()}.${extension}`;
    const bytes = await readFile(file, onProgress, signal);
    if (signal?.aborted) throw new DOMException("Import cancelled.", "AbortError");
    await this.database?.registerFileBuffer(virtualName, bytes);
    onProgress(97);
    if (extension === "csv") {
      await this.connection?.insertCSVFromPath(virtualName, {
        name: tableName,
        schema: "main",
        create: true,
        detect: true,
        header: true,
      });
    } else {
      await this.connection?.insertJSONFromPath(virtualName, {
        name: tableName,
        schema: "main",
        create: true,
      });
    }
    this.tableNames.push(tableName);
    onProgress(100);
    return { tableName, tables: await this.getSchema() };
  }

  async getSchema(): Promise<TableInfo[]> {
    await this.initialize();
    const connection = this.connection;
    if (!connection) return [];
    const columnsResult = await connection.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position
    `);
    const grouped = new Map<string, TableInfo>();
    for (const row of columnsResult.toArray() as unknown[]) {
      if (!isRecord(row)) continue;
      const record = row;
      const name = String(record.table_name);
      const current = grouped.get(name) ?? { name, rowCount: 0, columns: [] };
      current.columns.push({
        name: String(record.column_name),
        type: String(record.data_type),
        nullable: String(record.is_nullable).toUpperCase() === "YES",
      });
      grouped.set(name, current);
    }
    await Promise.all([...grouped.values()].map(async (table) => {
      const count = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`);
      const row: unknown = (count.toArray() as unknown[])[0];
      table.rowCount = Number(isRecord(row) ? row.count ?? 0 : 0);
    }));
    return [...grouped.values()];
  }

  async query(sql: string): Promise<QueryResult> {
    await this.initialize();
    const connection = this.connection;
    if (!connection) throw new Error("DuckDB did not initialize.");
    const safeSql = validateReadOnlySql(sql);
    const canWrap = /^\s*(select|with)\b/i.test(safeSql);
    const boundedSql = canWrap
      ? `SELECT * FROM (${safeSql}) AS __minitools_result LIMIT ${MAX_RESULT_ROWS + 1}`
      : safeSql;
    const started = performance.now();
    const reader = await connection.send(boundedSql);
    const batches = await reader.readAll();
    return tableToResult(new Table(batches), Math.round(performance.now() - started));
  }

  async cancelQuery(): Promise<boolean> {
    return this.connection?.cancelSent() ?? false;
  }

  async close(): Promise<void> {
    await this.connection?.close();
    await this.database?.terminate();
    this.connection = null;
    this.database = null;
  }
}
