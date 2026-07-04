/**
 * Asynchronous export jobs: the HTTP request only enqueues; generation runs
 * off the request path so the UI never blocks. Files land in data/exports/.
 */
import path from "node:path";
import { DIRS } from "../config.js";
import { getDb } from "../db.js";
import { getRunResults, type StoredSummary } from "../services/analyzer.js";
import { buildExcelExport } from "./excelExport.js";
import { buildPdfExport } from "./pdfExport.js";
import { sseEmit } from "../sse.js";

export interface ExportParams {
  kind: "excel" | "pdf";
  runId: number;
  /** restrict to these FA refs (filtered view only) */
  faRefs?: string[];
  detailFaRefs?: string[];
  title?: string;
}

export function enqueueExport(params: ExportParams): number {
  const db = getDb();
  const res = db
    .prepare("INSERT INTO export_jobs(kind, params_json, status, created_at) VALUES(?,?,?,?)")
    .run(params.kind, JSON.stringify(params), "pending", new Date().toISOString());
  const jobId = Number(res.lastInsertRowid);
  setImmediate(() => void runJob(jobId, params));
  return jobId;
}

async function runJob(jobId: number, params: ExportParams): Promise<void> {
  const db = getDb();
  db.prepare("UPDATE export_jobs SET status='running' WHERE id=?").run(jobId);
  try {
    let summaries: StoredSummary[] = getRunResults(params.runId);
    if (params.faRefs?.length) {
      const keep = new Set(params.faRefs);
      summaries = summaries.filter((s) => keep.has(s.faRef));
    }
    const ext = params.kind === "excel" ? "xlsx" : "pdf";
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const outPath = path.join(DIRS.exports, `FACM_${params.kind}_${stamp}_${jobId}.${ext}`);

    if (params.kind === "excel") {
      await buildExcelExport(summaries, { detailFaRefs: params.detailFaRefs, title: params.title }, outPath);
    } else {
      await buildPdfExport(summaries, { detailFaRef: params.detailFaRefs?.[0], title: params.title }, outPath);
    }

    db.prepare("UPDATE export_jobs SET status='done', file_path=?, finished_at=? WHERE id=?")
      .run(outPath, new Date().toISOString(), jobId);
    sseEmit("exports", "export-done", { jobId, kind: params.kind });
  } catch (e) {
    db.prepare("UPDATE export_jobs SET status='error', error=?, finished_at=? WHERE id=?")
      .run(e instanceof Error ? e.message : String(e), new Date().toISOString(), jobId);
    sseEmit("exports", "export-error", { jobId, error: String(e) });
  }
}

export function getJob(jobId: number): Record<string, unknown> | undefined {
  return getDb().prepare("SELECT * FROM export_jobs WHERE id=?").get(jobId) as
    | Record<string, unknown>
    | undefined;
}
