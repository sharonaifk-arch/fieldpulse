/**
 * Analysis orchestration: hash -> cache lookup -> worker pool -> persistence,
 * with per-file progress streamed over SSE (channel "runs"). The pool keeps
 * long-lived workers so batch runs parallelize CPU-bound Excel parsing
 * without blocking the HTTP server.
 */
import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
// (path sert aussi à dériver le nom du dispositif depuis le dossier parent)
import type { AnalysisResult, AnalyzeOptions } from "@facm/core";
import { ENGINE_VERSION, analyzeWorkbook } from "@facm/core";
import { CONFIG, SERVER_ROOT } from "../config.js";
import { CACHE_VERSION, getDb, getSetting } from "../db.js";
import { sseEmit } from "../sse.js";
import { hashFile, type ScannedFile } from "./scanner.js";

const WORKER_PATH = path.join(SERVER_ROOT, "workers", "analyze.worker.mjs");

/* ---------------- worker pool ---------------- */

interface JobMsg {
  filePath: string;
  fileName: string;
  options: AnalyzeOptions;
}

interface PendingJob {
  resolve: (r: AnalysisResult) => void;
  reject: (e: Error) => void;
}

/** Last-resort path (also used when worker_threads is unavailable, e.g. packaged .exe). */
async function analyzeInProcess(msg: JobMsg): Promise<AnalysisResult> {
  const buf = await fs.promises.readFile(msg.filePath);
  return analyzeWorkbook(buf, msg.fileName, msg.options);
}

class WorkerPool {
  private workers: Worker[] = [];
  private queue: Array<{ msg: JobMsg; job: PendingJob }> = [];
  private idle: Worker[] = [];
  private pending = new Map<number, PendingJob>();
  private jobOfWorker = new Map<Worker, { id: number; msg: JobMsg }>();
  private nextJobId = 1;
  private everSucceeded = false;
  /** flips to true when workers can't run in this environment */
  private inProcess = false;

  constructor(private size: number) {}

  private spawn(): Worker | null {
    let w: Worker;
    try {
      w = new Worker(WORKER_PATH);
    } catch {
      this.inProcess = true;
      return null;
    }
    w.on("message", (m: { id: number; ok: boolean; result?: AnalysisResult; error?: string }) => {
      this.jobOfWorker.delete(w);
      const job = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (job) {
        if (m.ok && m.result) {
          this.everSucceeded = true;
          job.resolve(m.result);
        } else {
          job.reject(new Error(m.error ?? "worker error"));
        }
      }
      this.idle.push(w);
      this.drain();
    });
    w.on("error", (err) => {
      const current = this.jobOfWorker.get(w);
      this.jobOfWorker.delete(w);
      this.workers = this.workers.filter((x) => x !== w);
      this.idle = this.idle.filter((x) => x !== w);
      if (current) {
        const job = this.pending.get(current.id);
        this.pending.delete(current.id);
        if (job) {
          if (!this.everSucceeded) {
            // environment can't run workers at all -> switch to in-process and retry
            this.inProcess = true;
            this.queue.push({ msg: current.msg, job });
          } else {
            job.reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
      this.drain();
    });
    this.workers.push(w);
    return w;
  }

  private drain(): void {
    while (this.queue.length > 0) {
      if (this.inProcess) {
        const { msg, job } = this.queue.shift()!;
        void analyzeInProcess(msg).then(job.resolve, job.reject);
        continue;
      }
      const w = this.idle.pop() ?? (this.workers.length < this.size ? this.spawn() : null);
      if (!w) {
        if (this.inProcess) continue; // spawn just failed -> loop back into in-process branch
        return; // all workers busy
      }
      const { msg, job } = this.queue.shift()!;
      const id = this.nextJobId++;
      this.pending.set(id, job);
      this.jobOfWorker.set(w, { id, msg });
      w.postMessage({ ...msg, id });
    }
  }

  run(filePath: string, fileName: string, options: AnalyzeOptions): Promise<AnalysisResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ msg: { filePath, fileName, options }, job: { resolve, reject } });
      this.drain();
    });
  }
}

const pool = new WorkerPool(CONFIG.workers);

/* ---------------- persistence helpers ---------------- */

function splitResult(r: AnalysisResult): { summary: string; lines: string } {
  const { lines, ...rest } = r;
  return { summary: JSON.stringify(rest), lines: JSON.stringify(lines) };
}

export interface StoredSummary extends Omit<AnalysisResult, "lines"> {
  fileHash: string;
  filePath: string | null;
  fromCache: boolean;
  analysisId: number;
}

function persistAnalysis(fileHash: string, r: AnalysisResult): number {
  const db = getDb();
  const { summary, lines } = splitResult(r);
  db.prepare("DELETE FROM analyses WHERE file_hash=? AND engine_version=? AND cache_version=?").run(
    fileHash, ENGINE_VERSION, CACHE_VERSION
  );
  const res = db
    .prepare(
      "INSERT INTO analyses(file_hash, engine_version, cache_version, analyzed_at, summary_json, lines_json) VALUES (?,?,?,?,?,?)"
    )
    .run(fileHash, ENGINE_VERSION, CACHE_VERSION, r.analyzedAt, summary, lines);
  return Number(res.lastInsertRowid);
}

function findCached(fileHash: string): { id: number; summary_json: string } | undefined {
  return getDb()
    .prepare(
      "SELECT id, summary_json FROM analyses WHERE file_hash=? AND engine_version=? AND cache_version=?"
    )
    .get(fileHash, ENGINE_VERSION, CACHE_VERSION) as { id: number; summary_json: string } | undefined;
}

function upsertFile(hash: string, f: { name: string; path: string | null; size: number; mtimeMs: number }): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO files(hash,name,path,size,mtime,first_seen,last_seen) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(hash) DO UPDATE SET name=excluded.name, path=excluded.path, size=excluded.size,
         mtime=excluded.mtime, last_seen=excluded.last_seen`
    )
    .run(hash, f.name, f.path, f.size, Math.round(f.mtimeMs), now, now);
}

function analyzeOptions(): AnalyzeOptions {
  return { deadlineDays: Number(getSetting("deadlineDays", "30")) };
}

/**
 * SHA256 with a shortcut: if the same path was hashed before and size+mtime
 * are unchanged, reuse the stored hash instead of re-reading the whole file.
 * Big win when previewing large synced folders repeatedly.
 */
async function cachedHash(f: ScannedFile): Promise<string> {
  const row = getDb()
    .prepare("SELECT hash, size, mtime FROM files WHERE path=? ORDER BY last_seen DESC LIMIT 1")
    .get(f.path) as { hash: string; size: number; mtime: number } | undefined;
  if (row && row.size === f.size && row.mtime === Math.round(f.mtimeMs)) return row.hash;
  return hashFile(f.path);
}

/* ---------------- cache preview (scan mode) ---------------- */

export interface CachePreviewEntry extends ScannedFile {
  hash: string;
  cached: boolean;
}

export async function previewFiles(files: ScannedFile[]): Promise<CachePreviewEntry[]> {
  const out: CachePreviewEntry[] = [];
  for (const f of files) {
    const hash = await cachedHash(f);
    out.push({ ...f, hash, cached: findCached(hash) !== undefined });
  }
  return out;
}

/* ---------------- run orchestration ---------------- */

export interface RunRequest {
  mode: "upload" | "scan" | "library";
  source: string; // folder path or "upload"
  files: ScannedFile[];
  force: boolean; // ignore cache
}

export function startRun(req: RunRequest): number {
  const db = getDb();
  const res = db
    .prepare("INSERT INTO runs(started_at, mode, source, status) VALUES (?,?,?, 'running')")
    .run(new Date().toISOString(), req.mode, req.source);
  const runId = Number(res.lastInsertRowid);
  void executeRun(runId, req).catch((e) => {
    db.prepare("UPDATE runs SET status='error', finished_at=?, stats_json=? WHERE id=?").run(
      new Date().toISOString(), JSON.stringify({ error: String(e) }), runId
    );
    sseEmit("runs", "run-error", { runId, error: String(e) });
  });
  return runId;
}

async function executeRun(runId: number, req: RunRequest): Promise<void> {
  const db = getDb();
  const total = req.files.length;
  let done = 0, fromCache = 0, analyzed = 0, errors = 0;
  const emit = (current: string | null) =>
    sseEmit("runs", "progress", { runId, total, done, fromCache, analyzed, errors, current });

  emit(null);
  const options = analyzeOptions();

  // Hash sequentially (fast, I/O bound), analyze via pool (CPU bound).
  const jobs: Promise<void>[] = [];
  for (const f of req.files) {
    emit(f.name);
    let hash: string;
    try {
      hash = await cachedHash(f);
    } catch (e) {
      errors++; done++;
      db.prepare("INSERT OR REPLACE INTO run_files(run_id,file_hash,analysis_id,from_cache,status) VALUES(?,?,?,?,?)")
        .run(runId, `unreadable:${f.path}`, null, 0, `error:${String(e)}`);
      emit(f.name);
      continue;
    }
    upsertFile(hash, f);

    const cached = req.force ? undefined : findCached(hash);
    if (cached) {
      fromCache++; done++;
      db.prepare("INSERT OR REPLACE INTO run_files(run_id,file_hash,analysis_id,from_cache,status) VALUES(?,?,?,1,'ok')")
        .run(runId, hash, cached.id, );
      emit(f.name);
      continue;
    }

    jobs.push(
      pool.run(f.path, f.name, options).then(
        (result) => {
          // Nom du dispositif : les Customer Lists OneDrive sont classées dans
          // des sous-dossiers portant le nom du dispositif ("PG ACCOLADE/…").
          // Le dossier parent prime sur la Material Description dominante.
          if (req.mode === "scan") {
            const parent = path.dirname(f.path);
            if (path.resolve(parent) !== path.resolve(req.source)) {
              result.deviceHint = path.basename(parent);
            }
          }
          const analysisId = persistAnalysis(hash, result);
          analyzed++; done++;
          getDb()
            .prepare("INSERT OR REPLACE INTO run_files(run_id,file_hash,analysis_id,from_cache,status) VALUES(?,?,?,0,'ok')")
            .run(runId, hash, analysisId);
          emit(f.name);
        },
        (e: Error) => {
          errors++; done++;
          getDb()
            .prepare("INSERT OR REPLACE INTO run_files(run_id,file_hash,analysis_id,from_cache,status) VALUES(?,?,?,0,?)")
            .run(runId, hash, null, `error:${e.message}`);
          emit(f.name);
        }
      )
    );
  }

  await Promise.all(jobs);
  const stats = { total, fromCache, analyzed, errors };
  db.prepare("UPDATE runs SET status='done', finished_at=?, stats_json=? WHERE id=?").run(
    new Date().toISOString(), JSON.stringify(stats), runId
  );
  sseEmit("runs", "run-done", { runId, ...stats });
}

/* ---------------- result access ---------------- */

export function getRunResults(runId: number): StoredSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT rf.file_hash, rf.from_cache, rf.analysis_id, a.summary_json, f.path
       FROM run_files rf
       LEFT JOIN analyses a ON a.id = rf.analysis_id
       LEFT JOIN files f ON f.hash = rf.file_hash
       WHERE rf.run_id = ? AND rf.analysis_id IS NOT NULL`
    )
    .all(runId) as Array<{ file_hash: string; from_cache: number; analysis_id: number; summary_json: string; path: string | null }>;
  return rows.map((r) => ({
    ...(JSON.parse(r.summary_json) as Omit<AnalysisResult, "lines">),
    fileHash: r.file_hash,
    filePath: r.path,
    fromCache: r.from_cache === 1,
    analysisId: r.analysis_id,
  }));
}

export function getLatestRunId(): number | null {
  const row = getDb()
    .prepare("SELECT id FROM runs WHERE status='done' ORDER BY id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function getAnalysisLines(analysisId: number): unknown[] {
  const row = getDb().prepare("SELECT lines_json FROM analyses WHERE id=?").get(analysisId) as
    | { lines_json: string }
    | undefined;
  return row ? (JSON.parse(row.lines_json) as unknown[]) : [];
}
