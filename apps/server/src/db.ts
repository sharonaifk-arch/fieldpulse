/**
 * Local cache & history store — SQLite via node:sqlite (built into Node 22.5+,
 * no native compilation). Versioned migrations allow future schema changes
 * without losing user data (annotations, library).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { CONFIG } from "./config.js";

export const CACHE_VERSION = 1;

let db: DatabaseSync | null = null;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS files (
    hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT,
    size INTEGER,
    mtime INTEGER,
    first_seen TEXT,
    last_seen TEXT
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_hash TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    cache_version INTEGER NOT NULL,
    analyzed_at TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    UNIQUE(file_hash, engine_version, cache_version)
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    mode TEXT NOT NULL,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    stats_json TEXT
  );
  CREATE TABLE IF NOT EXISTS run_files (
    run_id INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    analysis_id INTEGER,
    from_cache INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    PRIMARY KEY (run_id, file_hash)
  );
  CREATE TABLE IF NOT EXISTS annotations (
    fa_ref TEXT PRIMARY KEY,
    comment TEXT,
    manual_status TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS library_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    path TEXT NOT NULL,
    options_json TEXT
  );
  CREATE TABLE IF NOT EXISTS saved_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    filters_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS export_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    params_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    file_path TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_analyses_hash ON analyses(file_hash);
  CREATE INDEX IF NOT EXISTS idx_run_files_run ON run_files(run_id);
  `,
];

export function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(path.join(CONFIG.dataDir, "facm.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  const row = (() => {
    try {
      return db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
        | { value: string }
        | undefined;
    } catch {
      return undefined;
    }
  })();
  const current = row ? Number(row.value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v]);
  db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(String(MIGRATIONS.length));
  return db;
}

export function clearCache(): void {
  const d = getDb();
  d.exec("DELETE FROM analyses; DELETE FROM run_files; DELETE FROM runs; DELETE FROM files;");
}

/* ---------- settings ---------- */

export function getSetting(key: string, fallback: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value);
}
