/**
 * Local folder scanner (Teams/OneDrive synced folders). Applies the user's
 * filters and the fixed exclusions: Excel temp files (~$...), archive-like
 * directories, oversized files. Read-only: never touches the sources.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface ScanOptions {
  includeSubfolders?: boolean;
  keywords?: string[]; // filename must contain at least one (if provided)
  countries?: string[]; // filename must contain at least one (if provided)
  maxFileSizeMb?: number;
}

export interface ScannedFile {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

const EXCLUDED_DIRS = new Set([
  "archive", "archives", "backup", "backups", "old", "snapshots",
  "exports", "__pycache__", ".venv", "node_modules", ".git",
]);

export function scanFolder(root: string, opts: ScanOptions = {}): ScannedFile[] {
  const maxBytes = (opts.maxFileSizeMb ?? 100) * 1024 * 1024;
  const keywords = (opts.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  const countries = (opts.countries ?? []).map((c) => c.toLowerCase()).filter(Boolean);
  const out: ScannedFile[] = [];

  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip silently, reported at top level if root
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!opts.includeSubfolders && depth > 0) continue;
        if (EXCLUDED_DIRS.has(e.name.toLowerCase())) continue;
        if (opts.includeSubfolders) walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!lower.endsWith(".xlsx")) continue;
      if (e.name.startsWith("~$")) continue; // Excel temp/lock files
      if (keywords.length && !keywords.some((k) => lower.includes(k))) continue;
      if (countries.length && !countries.some((c) => lower.includes(c))) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size > maxBytes) continue;
      out.push({ path: full, name: e.name, size: st.size, mtimeMs: st.mtimeMs });
    }
  };

  walk(root, 0);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** SHA256 of file content — authoritative change detection. */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => h.update(chunk))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}
