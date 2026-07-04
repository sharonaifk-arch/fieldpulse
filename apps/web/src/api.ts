/** Typed REST + SSE client. No business logic here — display only. */
import type { AnalysisResult, FaLine } from "@facm/core";

export interface StoredSummary extends Omit<AnalysisResult, "lines"> {
  fileHash: string;
  filePath: string | null;
  fromCache: boolean;
  analysisId: number;
}

export interface RunProgress {
  runId: number;
  total: number;
  done: number;
  fromCache: number;
  analyzed: number;
  errors: number;
  current: string | null;
}

export interface Annotation {
  fa_ref: string;
  comment: string | null;
  manual_status: string | null;
  updated_at: string;
}

export interface FaDiffEntry {
  faRef: string;
  fileName: string;
  kind: "added" | "removed" | "status-changed" | "kpi-changed" | "unchanged";
  before: { closureStatus: string; openResponses: number; qtyMissing: number } | null;
  after: { closureStatus: string; openResponses: number; qtyMissing: number } | null;
}

/**
 * Jeton de session local : posé dans l'URL par le lanceur (?facmtoken=…),
 * stocké en sessionStorage puis retiré de l'URL. Envoyé en header sur chaque
 * appel API (et en query pour les flux SSE, qui n'acceptent pas de header).
 */
const TOKEN: string | null = (() => {
  const m = window.location.search.match(/[?&]facmtoken=([a-f0-9]+)/);
  if (m) {
    sessionStorage.setItem("facm.token", m[1]);
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }
  return sessionStorage.getItem("facm.token");
})();

export const withToken = (url: string): string =>
  TOKEN ? `${url}${url.includes("?") ? "&" : "?"}token=${TOKEN}` : url;

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (!(init?.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (TOKEN) headers["X-FACM-Token"] = TOKEN;
  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  latestResults: () => http<{ runId: number | null; results: StoredSummary[] }>("/api/runs/latest/results"),
  runResults: (id: number) => http<{ runId: number; results: StoredSummary[] }>(`/api/runs/${id}/results`),
  runs: (limit = 20) => http<Array<Record<string, unknown>>>(`/api/runs?limit=${limit}`),

  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return http<{ runId: number; files: number }>("/api/upload", { method: "POST", body: fd });
  },

  scanPreview: (path: string, options: object) =>
    http<{ total: number; cached: number; changed: number; files: Array<{ name: string; size: number; cached: boolean; path: string }> }>(
      "/api/scan/preview",
      { method: "POST", body: JSON.stringify({ path, options }) }
    ),
  scanRun: (path: string, options: object, force: boolean) =>
    http<{ runId: number; files: number }>("/api/scan/run", {
      method: "POST",
      body: JSON.stringify({ path, options, force }),
    }),

  lines: (analysisId: number, params: { offset?: number; limit?: number; filter?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params.offset) q.set("offset", String(params.offset));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.filter) q.set("filter", params.filter);
    if (params.search) q.set("search", params.search);
    return http<{ total: number; offset: number; limit: number; lines: FaLine[] }>(
      `/api/analyses/${analysisId}/lines?${q}`
    );
  },

  diff: () => http<{ runA: number; runB: number; diff: FaDiffEntry[] }>("/api/diff"),

  annotations: () => http<Annotation[]>("/api/annotations"),
  saveAnnotation: (faRef: string, comment: string | null, manualStatus: string | null) =>
    http<{ ok: boolean }>(`/api/annotations/${encodeURIComponent(faRef)}`, {
      method: "PUT",
      body: JSON.stringify({ comment, manualStatus }),
    }),

  libraryFolders: () => http<Array<{ id: number; label: string; path: string; options_json: string }>>("/api/library/folders"),
  saveFolder: (label: string, path: string, options: object) =>
    http<{ id: number }>("/api/library/folders", { method: "POST", body: JSON.stringify({ label, path, options }) }),
  deleteFolder: (id: number) => http<{ ok: boolean }>(`/api/library/folders/${id}`, { method: "DELETE" }),

  startExport: (params: object) => http<{ jobId: number }>("/api/exports", { method: "POST", body: JSON.stringify(params) }),
  exportStatus: (id: number) => http<{ status: string; file_path?: string; error?: string }>(`/api/exports/${id}`),

  faHistory: (faRef: string) =>
    http<{ faRef: string; points: Array<{ runId: number; at: string; open: number; qtyMissing: number; completion: number | null }> }>(
      `/api/fa/${encodeURIComponent(faRef)}/history`
    ),

  openFile: (fileHash: string) =>
    http<{ ok: boolean }>("/api/file/open", { method: "POST", body: JSON.stringify({ fileHash }) }),

  watchStatus: () => http<{ active: boolean; path: string | null }>("/api/watch"),
  watch: (path: string) => http<{ active: boolean; path: string | null }>("/api/watch", { method: "POST", body: JSON.stringify({ path }) }),
  stopWatch: () => http<{ active: boolean }>("/api/watch", { method: "POST", body: JSON.stringify({ stop: true }) }),

  settings: () => http<{ language: string; deadlineDays: number; debug: boolean }>("/api/settings"),
  saveSettings: (s: object) => http<{ ok: boolean }>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  clearCache: () => http<{ ok: boolean }>("/api/cache/clear", { method: "POST" }),
  cacheStats: () => http<{ files: number; analyses: number; runs: number }>("/api/cache/stats"),
};

/** Subscribes to an SSE channel; returns an unsubscribe function. */
export function subscribe(
  url: string,
  handlers: Record<string, (data: unknown) => void>
): () => void {
  const es = new EventSource(withToken(url));
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => {
      try {
        fn(JSON.parse((e as MessageEvent).data));
      } catch {
        /* malformed event — ignore */
      }
    });
  }
  return () => es.close();
}
