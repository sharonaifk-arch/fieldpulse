import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** apps/server — same depth from src/ and dist/, so this works in dev and prod. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(SERVER_ROOT, "../..");

function readDotEnv(): Record<string, string> {
  const file = path.join(REPO_ROOT, ".env");
  const out: Record<string, string> = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
  }
  return out;
}

const dotenv = readDotEnv();
const env = (k: string, fallback: string) => process.env[k] ?? dotenv[k] ?? fallback;

export const CONFIG = {
  port: Number(env("FACM_PORT", "4560")),
  host: env("FACM_HOST", "127.0.0.1"),
  dataDir: path.resolve(REPO_ROOT, env("FACM_DATA_DIR", "./data")),
  defaultLang: env("FACM_LANG", "fr"),
  workers: Number(env("FACM_WORKERS", "0")) || Math.min(Math.max(os.cpus().length - 1, 1), 4),
  // FACM_WEB_DIST is set by the portable .exe launcher (resources live next to the exe)
  webDist: path.resolve(REPO_ROOT, env("FACM_WEB_DIST", "apps/web/dist")),
  openBrowser: env("FACM_OPEN_BROWSER", "0") === "1",
  /**
   * Jeton de session local : requis sur /api/* pour empêcher un autre
   * process local (malware non privilégié, autre appli) de lire les données
   * PII via l'API. Fourni par le lanceur (Electron/exe) ou généré au boot.
   * Désactivé uniquement en dev (npm run dev) ou via FACM_DISABLE_TOKEN=1.
   */
  token:
    env("FACM_DISABLE_TOKEN", "0") === "1" || process.env.npm_lifecycle_event === "dev"
      ? null
      : env("FACM_TOKEN", "") || crypto.randomBytes(24).toString("hex"),
};

export const DIRS = {
  uploads: path.join(CONFIG.dataDir, "uploads"),
  exports: path.join(CONFIG.dataDir, "exports"),
};

export function ensureDirs(): void {
  for (const d of [CONFIG.dataDir, DIRS.uploads, DIRS.exports]) fs.mkdirSync(d, { recursive: true });
}
