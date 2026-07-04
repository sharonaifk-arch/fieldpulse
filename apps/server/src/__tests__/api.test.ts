/**
 * Tests d'intégration API (fastify inject, aucun port ouvert) :
 * jeton de session, upload invalide, export sans analyse, pagination lignes.
 * L'environnement est posé AVANT l'import du serveur (CONFIG est figé à l'import).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import FormData from "form-data";
import type { FastifyInstance } from "fastify";

const TOKEN = "test-token-0123456789abcdef";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "facm-test-"));

let app: FastifyInstance;
let getDb: typeof import("../db.js").getDb;

beforeAll(async () => {
  process.env.FACM_DATA_DIR = dataDir;
  process.env.FACM_TOKEN = TOKEN;
  process.env.FACM_WEB_DIST = path.join(dataDir, "no-web"); // pas de statique en test
  delete process.env.FACM_DISABLE_TOKEN;
  delete process.env.npm_lifecycle_event; // sinon le mode "dev" désactive le jeton

  const main = await import("../main.js");
  ({ getDb } = await import("../db.js"));
  app = (await main.buildApp()) as unknown as FastifyInstance;
});

afterAll(async () => {
  await app.close();
  // SQLite garde un verrou WAL sur Windows — le nettoyage peut échouer, non bloquant
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* temp dir, purgé par l'OS */
  }
});

/** inject multipart : light-my-request exige un content-length explicite */
function injectForm(url: string, form: FormData) {
  const payload = form.getBuffer();
  return app.inject({
    method: "POST",
    url,
    headers: { ...auth, ...form.getHeaders(), "content-length": String(payload.length) },
    payload,
  });
}

const auth = { "x-facm-token": TOKEN };

describe("jeton de session API", () => {
  it("refuse un appel API sans jeton (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(401);
  });

  it("refuse un jeton invalide (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings", headers: { "x-facm-token": "wrong" } });
    expect(res.statusCode).toBe(401);
  });

  it("accepte le bon jeton (header ou query pour SSE)", async () => {
    const viaHeader = await app.inject({ method: "GET", url: "/api/settings", headers: auth });
    expect(viaHeader.statusCode).toBe(200);
    const viaQuery = await app.inject({ method: "GET", url: `/api/cache/stats?token=${TOKEN}` });
    expect(viaQuery.statusCode).toBe(200);
  });

  it("laisse /api/health public (sonde de vivacité)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
  });
});

describe("upload", () => {
  it("rejette un upload sans aucun .xlsx (400)", async () => {
    const form = new FormData();
    form.append("files", Buffer.from("not an excel"), { filename: "notes.txt" });
    const res = await injectForm("/api/upload", form);
    expect(res.statusCode).toBe(400);
  });

  it("neutralise les noms de fichiers avec traversée de chemin", async () => {
    const form = new FormData();
    // extension non-xlsx après basename -> rejeté, et surtout rien n'est écrit hors uploads/
    form.append("files", Buffer.from("x"), { filename: "..\\..\\evil.txt" });
    const res = await injectForm("/api/upload", form);
    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(path.join(dataDir, "evil.txt"))).toBe(false);
  });
});

describe("exports", () => {
  it("retourne 400 quand aucune analyse n'est disponible", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/exports", headers: auth,
      payload: { kind: "pdf" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("retourne 400 pour un format inconnu", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/exports", headers: auth,
      payload: { kind: "docx" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuse de servir un fichier hors du dossier exports (confinement)", async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO export_jobs(kind, params_json, status, file_path, created_at) VALUES('pdf','{}','done',?,?)"
    ).run(path.join(dataDir, "facm.sqlite"), new Date().toISOString());
    const row = db.prepare("SELECT id FROM export_jobs ORDER BY id DESC LIMIT 1").get() as { id: number };
    const res = await app.inject({ method: "GET", url: `/api/exports/${row.id}/download`, headers: auth });
    expect(res.statusCode).toBe(403);
  });
});

describe("pagination des lignes d'analyse", () => {
  let analysisId: number;

  beforeAll(() => {
    const lines = Array.from({ length: 250 }, (_, i) => ({
      row: i + 3,
      soldTo: String(1000 + i), soldToRaw: String(1000 + i),
      hospitalName: `HOSPITAL ${i}`, city: i % 2 ? "PARIS" : "LYON",
      materialNumber: "M1", batchNumber: `B${i}`,
      formStatus: i < 40 ? "open" : "received",
      qtyMissing: i < 10 ? 2 : 0,
      qtyReceivedEffective: 1, qtyToReturn: 1, form: "", rga: "",
    }));
    const db = getDb();
    db.prepare(
      "INSERT INTO analyses(file_hash, engine_version, cache_version, analyzed_at, summary_json, lines_json) VALUES('h1','t',1,?,?,?)"
    ).run(new Date().toISOString(), "{}", JSON.stringify(lines));
    analysisId = (db.prepare("SELECT id FROM analyses ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  });

  it("pagine avec offset/limit", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/analyses/${analysisId}/lines?offset=100&limit=100`, headers: auth,
    });
    const body = res.json() as { total: number; lines: unknown[] };
    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(250);
    expect(body.lines).toHaveLength(100);
  });

  it("filtre les lignes ouvertes/bloquantes", async () => {
    const open = (await app.inject({
      method: "GET", url: `/api/analyses/${analysisId}/lines?filter=open&limit=500`, headers: auth,
    })).json() as { total: number };
    expect(open.total).toBe(40);
    const blocking = (await app.inject({
      method: "GET", url: `/api/analyses/${analysisId}/lines?filter=blocking&limit=500`, headers: auth,
    })).json() as { total: number };
    expect(blocking.total).toBe(40); // les 40 open incluent les 10 qtyMissing
  });

  it("plafonne limit à 1000", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/analyses/${analysisId}/lines?limit=99999`, headers: auth,
    });
    expect((res.json() as { limit: number }).limit).toBe(1000);
  });
});
