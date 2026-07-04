/**
 * REST API. All business values come from @facm/core results — the server
 * only orchestrates. Error responses stay human-readable for the business
 * user; technical detail goes to the server log.
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FaLine } from "@facm/core";
import { DIRS } from "./config.js";
import { clearCache, getDb, getSetting, setSetting } from "./db.js";
import { scanFolder, type ScanOptions } from "./services/scanner.js";
import {
  getAnalysisLines, getLatestRunId, getRunResults, previewFiles, startRun,
} from "./services/analyzer.js";
import { diffRuns } from "./services/diff.js";
import { getWatchStatus, startWatch, stopWatch } from "./services/watcher.js";
import { enqueueExport, getJob, type ExportParams } from "./exports/jobs.js";
import { sseSubscribe } from "./sse.js";

interface ScanBody {
  path: string;
  options?: ScanOptions;
  force?: boolean;
}

/** Valide un chemin de dossier fourni par l'utilisateur (scan/watch). */
function validateFolder(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500 || raw.includes("\0")) {
    return { ok: false, error: "Chemin invalide" };
  }
  const resolved = path.resolve(raw);
  let st: fs.Stats;
  try {
    st = fs.statSync(resolved);
  } catch {
    return { ok: false, error: "Dossier introuvable — vérifiez le chemin collé" };
  }
  if (!st.isDirectory()) return { ok: false, error: "Ce chemin pointe vers un fichier, pas un dossier" };
  return { ok: true, path: resolved };
}

export function registerRoutes(app: FastifyInstance): void {
  /* ---------- health ---------- */
  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  /* ---------- Mode 1: upload ---------- */
  app.post("/api/upload", async (req, reply) => {
    const parts = req.files();
    const saved: { path: string; name: string; size: number; mtimeMs: number }[] = [];
    for await (const part of parts) {
      // path.basename neutralise toute tentative de traversée (../../, chemins absolus)
      const safeName = path.basename(part.filename ?? "");
      if (!safeName.toLowerCase().endsWith(".xlsx") || safeName.startsWith("~$")) {
        await part.toBuffer().catch(() => {}); // drainer le flux sinon l'itération multipart bloque
        continue;
      }
      const dest = path.resolve(DIRS.uploads, `${Date.now()}_${safeName}`);
      if (!dest.startsWith(path.resolve(DIRS.uploads) + path.sep)) {
        await part.toBuffer().catch(() => {});
        continue; // confinement uploads
      }
      await fs.promises.writeFile(dest, await part.toBuffer());
      const st = fs.statSync(dest);
      saved.push({ path: dest, name: safeName, size: st.size, mtimeMs: st.mtimeMs });
    }
    if (saved.length === 0) return reply.code(400).send({ error: "Aucun fichier .xlsx reçu" });
    const runId = startRun({ mode: "upload", source: "upload", files: saved, force: true });
    return { runId, files: saved.length };
  });

  /* ---------- Mode 2: folder scan ---------- */
  app.post("/api/scan/preview", async (req, reply) => {
    const body = req.body as ScanBody;
    const v = validateFolder(body?.path);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const files = scanFolder(v.path, body.options ?? {});
    const preview = await previewFiles(files);
    return {
      total: preview.length,
      cached: preview.filter((p) => p.cached).length,
      changed: preview.filter((p) => !p.cached).length,
      files: preview,
    };
  });

  app.post("/api/scan/run", async (req, reply) => {
    const body = req.body as ScanBody;
    const v = validateFolder(body?.path);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const files = scanFolder(v.path, body.options ?? {});
    if (files.length === 0) return reply.code(400).send({ error: "Aucun fichier Excel ne correspond aux filtres" });
    const runId = startRun({ mode: "scan", source: v.path, files, force: body.force ?? false });
    return { runId, files: files.length };
  });

  /* ---------- runs / results ---------- */
  app.get("/api/runs", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return getDb()
      .prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?")
      .all(limit);
  });

  app.get("/api/runs/latest/results", async () => {
    const runId = getLatestRunId();
    if (runId === null) return { runId: null, results: [] };
    return { runId, results: getRunResults(runId) };
  });

  app.get("/api/runs/:id/results", async (req) => {
    const id = Number((req.params as { id: string }).id);
    return { runId: id, results: getRunResults(id) };
  });

  app.get("/api/runs/events", (req, reply) => {
    sseSubscribe("runs", reply);
  });

  /* ---------- analysis lines (paginated, filterable) ---------- */
  app.get("/api/analyses/:id/lines", async (req) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { offset?: string; limit?: string; filter?: string; search?: string };
    const offset = Number(q.offset ?? 0);
    const limit = Math.min(Number(q.limit ?? 100), 1000);
    let lines = getAnalysisLines(id) as FaLine[];
    if (q.filter === "blocking") {
      lines = lines.filter((l) => l.formStatus === "open" || l.formStatus === "review" || l.qtyMissing > 0);
    } else if (q.filter === "open") {
      lines = lines.filter((l) => l.formStatus === "open" || l.formStatus === "review");
    } else if (q.filter === "active") {
      lines = lines.filter((l) => l.formStatus !== "excluded");
    }
    if (q.search) {
      const s = q.search.toLowerCase();
      lines = lines.filter(
        (l) =>
          l.soldToRaw.toLowerCase().includes(s) ||
          l.hospitalName.toLowerCase().includes(s) ||
          l.city.toLowerCase().includes(s) ||
          l.materialNumber.toLowerCase().includes(s) ||
          l.batchNumber.toLowerCase().includes(s)
      );
    }
    return { total: lines.length, offset, limit, lines: lines.slice(offset, offset + limit) };
  });

  /* ---------- historique d'une FA (sparklines) ---------- */
  // Série temporelle depuis les runs stockés : réponses ouvertes, qté
  // manquante et taux de réponse à chaque analyse, agrégés par référence FA.
  app.get("/api/fa/:faRef/history", async (req) => {
    const faRef = (req.params as { faRef: string }).faRef;
    const db = getDb();
    const runs = db
      .prepare("SELECT id, finished_at FROM runs WHERE status='done' ORDER BY id ASC LIMIT 60")
      .all() as Array<{ id: number; finished_at: string }>;
    const points: Array<{ runId: number; at: string; open: number; qtyMissing: number; completion: number | null }> = [];
    for (const run of runs) {
      const rows = db
        .prepare(
          `SELECT a.summary_json FROM run_files rf JOIN analyses a ON a.id = rf.analysis_id
           WHERE rf.run_id = ? AND rf.analysis_id IS NOT NULL`
        )
        .all(run.id) as Array<{ summary_json: string }>;
      let open = 0, qtyMissing = 0, expected = 0, answered = 0, found = false;
      for (const row of rows) {
        const s = JSON.parse(row.summary_json) as {
          faRef: string;
          kpis: { openResponses: number; qtyMissing: number; expectedResponses: number; formsReceived: number; closedByGfe: number };
        };
        if (s.faRef !== faRef) continue;
        found = true;
        open += s.kpis.openResponses;
        qtyMissing += s.kpis.qtyMissing;
        expected += s.kpis.expectedResponses;
        answered += s.kpis.formsReceived + s.kpis.closedByGfe;
      }
      if (found) {
        points.push({
          runId: run.id, at: run.finished_at, open, qtyMissing,
          completion: expected > 0 ? Math.round((answered / expected) * 1000) / 1000 : null,
        });
      }
    }
    return { faRef, points };
  });

  /* ---------- diff ---------- */
  app.get("/api/diff", async (req, reply) => {
    const q = req.query as { runA?: string; runB?: string };
    let runB = q.runB ? Number(q.runB) : getLatestRunId();
    let runA = q.runA ? Number(q.runA) : null;
    if (runA === null && runB !== null) {
      const prev = getDb()
        .prepare("SELECT id FROM runs WHERE status='done' AND id < ? ORDER BY id DESC LIMIT 1")
        .get(runB) as { id: number } | undefined;
      runA = prev?.id ?? null;
    }
    if (runA === null || runB === null) return reply.code(400).send({ error: "Pas assez d'analyses pour comparer" });
    return { runA, runB, diff: diffRuns(runA, runB) };
  });

  /* ---------- annotations (comments + manual follow-up status) ---------- */
  app.get("/api/annotations", async () => getDb().prepare("SELECT * FROM annotations").all());

  app.put("/api/annotations/:faRef", async (req) => {
    const faRef = (req.params as { faRef: string }).faRef;
    const body = req.body as { comment?: string | null; manualStatus?: string | null };
    getDb()
      .prepare(
        `INSERT INTO annotations(fa_ref, comment, manual_status, updated_at) VALUES(?,?,?,?)
         ON CONFLICT(fa_ref) DO UPDATE SET comment=excluded.comment,
           manual_status=excluded.manual_status, updated_at=excluded.updated_at`
      )
      .run(faRef, body.comment ?? null, body.manualStatus ?? null, new Date().toISOString());
    return { ok: true };
  });

  /* ---------- Mode 3: library (favorite folders + saved filters) ---------- */
  app.get("/api/library/folders", async () => getDb().prepare("SELECT * FROM library_folders").all());
  app.post("/api/library/folders", async (req) => {
    const b = req.body as { label: string; path: string; options?: ScanOptions };
    const r = getDb()
      .prepare("INSERT INTO library_folders(label, path, options_json) VALUES(?,?,?)")
      .run(b.label, b.path, JSON.stringify(b.options ?? {}));
    return { id: Number(r.lastInsertRowid) };
  });
  app.delete("/api/library/folders/:id", async (req) => {
    getDb().prepare("DELETE FROM library_folders WHERE id=?").run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.get("/api/library/filters", async () => getDb().prepare("SELECT * FROM saved_filters").all());
  app.post("/api/library/filters", async (req) => {
    const b = req.body as { label: string; filters: unknown };
    const r = getDb()
      .prepare("INSERT INTO saved_filters(label, filters_json) VALUES(?,?)")
      .run(b.label, JSON.stringify(b.filters));
    return { id: Number(r.lastInsertRowid) };
  });
  app.delete("/api/library/filters/:id", async (req) => {
    getDb().prepare("DELETE FROM saved_filters WHERE id=?").run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  /* ---------- exports (async jobs) ---------- */
  app.post("/api/exports", async (req, reply) => {
    const params = req.body as ExportParams;
    if (params?.kind !== "excel" && params?.kind !== "pdf") {
      return reply.code(400).send({ error: "Format d'export invalide" });
    }
    const runId = params.runId || getLatestRunId();
    if (!runId) return reply.code(400).send({ error: "Aucune analyse disponible à exporter" });
    const jobId = enqueueExport({ ...params, runId });
    return { jobId };
  });
  app.get("/api/exports/events", (req, reply) => sseSubscribe("exports", reply));
  app.get("/api/exports/:id", async (req, reply) => {
    const job = getJob(Number((req.params as { id: string }).id));
    if (!job) return reply.code(404).send({ error: "Export introuvable" });
    return job;
  });
  app.get("/api/exports/:id/download", async (req, reply) => {
    const job = getJob(Number((req.params as { id: string }).id));
    if (!job || job.status !== "done" || !job.file_path) {
      return reply.code(404).send({ error: "Export non prêt" });
    }
    const p = path.resolve(String(job.file_path));
    // confinement : ne sert jamais un fichier hors du dossier d'exports
    if (!p.startsWith(path.resolve(DIRS.exports) + path.sep)) {
      return reply.code(403).send({ error: "Accès refusé" });
    }
    const stream = fs.createReadStream(p);
    reply.header("Content-Disposition", `attachment; filename="${path.basename(p)}"`);
    reply.type(p.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return reply.send(stream);
  });

  /* ---------- ouvrir le fichier source dans Excel ---------- */
  // Sécurité : seul un hash connu de la base peut être ouvert (jamais un
  // chemin fourni par le client), et uniquement un .xlsx encore présent.
  app.post("/api/file/open", async (req, reply) => {
    const { fileHash } = req.body as { fileHash?: string };
    if (!fileHash || !/^[a-f0-9]{64}$/.test(fileHash)) {
      return reply.code(400).send({ error: "Fichier inconnu" });
    }
    const row = getDb().prepare("SELECT path FROM files WHERE hash=?").get(fileHash) as
      | { path: string | null }
      | undefined;
    const p = row?.path ? path.resolve(row.path) : null;
    if (!p || !p.toLowerCase().endsWith(".xlsx") || !fs.existsSync(p)) {
      return reply.code(404).send({ error: "Fichier introuvable sur le disque — relancez une analyse" });
    }
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", p], { detached: true, stdio: "ignore" });
    else if (process.platform === "darwin") spawn("open", [p], { detached: true, stdio: "ignore" });
    else spawn("xdg-open", [p], { detached: true, stdio: "ignore" });
    return { ok: true };
  });

  /* ---------- watch ---------- */
  app.get("/api/watch", async () => getWatchStatus());
  app.post("/api/watch", async (req, reply) => {
    const b = req.body as { path?: string; stop?: boolean };
    if (b.stop) {
      await stopWatch();
      return { active: false };
    }
    const v = validateFolder(b.path);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    await startWatch(v.path);
    return getWatchStatus();
  });
  app.get("/api/watch/events", (req, reply) => sseSubscribe("watch", reply));

  /* ---------- settings & cache ---------- */
  app.get("/api/settings", async () => ({
    language: getSetting("language", "fr"),
    deadlineDays: Number(getSetting("deadlineDays", "30")),
    debug: getSetting("debug", "0") === "1",
  }));
  app.put("/api/settings", async (req) => {
    const b = req.body as { language?: string; deadlineDays?: number; debug?: boolean };
    if (b.language) setSetting("language", b.language);
    if (b.deadlineDays !== undefined) setSetting("deadlineDays", String(b.deadlineDays));
    if (b.debug !== undefined) setSetting("debug", b.debug ? "1" : "0");
    return { ok: true };
  });

  app.post("/api/cache/clear", async () => {
    clearCache();
    return { ok: true };
  });

  app.get("/api/cache/stats", async () => {
    const db = getDb();
    const files = (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
    const analyses = (db.prepare("SELECT COUNT(*) c FROM analyses").get() as { c: number }).c;
    const runs = (db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
    return { files, analyses, runs };
  });
}
