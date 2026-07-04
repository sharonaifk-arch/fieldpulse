/** Global UI state (zustand): theme, language, results, progress, toasts. */
import { create } from "zustand";
import type { Annotation, RunProgress, StoredSummary } from "./api";
import { api } from "./api";
import type { Lang } from "./i18n";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface AppState {
  lang: Lang;
  theme: "dark" | "light";
  debug: boolean;
  deadlineDays: number;
  sidebarCollapsed: boolean;

  runId: number | null;
  results: StoredSummary[];
  loadingResults: boolean;
  progress: RunProgress | null;
  annotations: Record<string, Annotation>;
  watchedPath: string | null;
  filesChanged: boolean;
  /** préréglage de recherche pour la table Monitoring (posé par la carte) */
  monitoringSearch: string | null;

  toasts: Toast[];

  setLang: (l: Lang) => void;
  setTheme: (t: "dark" | "light") => void;
  toggleSidebar: () => void;
  setDebug: (d: boolean) => void;
  setDeadlineDays: (d: number) => void;
  setProgress: (p: RunProgress | null) => void;
  setWatchedPath: (p: string | null) => void;
  setFilesChanged: (v: boolean) => void;
  setMonitoringSearch: (s: string | null) => void;
  toast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
  refreshResults: () => Promise<void>;
  refreshAnnotations: () => Promise<void>;
}

let toastId = 1;

export const useAppStore = create<AppState>((set, get) => ({
  lang: (localStorage.getItem("facm.lang") as Lang) || "fr",
  theme: (localStorage.getItem("facm.theme") as "dark" | "light") || "light",
  debug: false,
  deadlineDays: 30,
  sidebarCollapsed: localStorage.getItem("fp.sidebar") === "1",

  runId: null,
  results: [],
  loadingResults: false,
  progress: null,
  annotations: {},
  watchedPath: null,
  filesChanged: false,
  monitoringSearch: null,

  toasts: [],

  setLang: (l) => {
    localStorage.setItem("facm.lang", l);
    set({ lang: l });
  },
  setTheme: (t) => {
    localStorage.setItem("facm.theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    set({ theme: t });
  },
  toggleSidebar: () =>
    set((s) => {
      localStorage.setItem("fp.sidebar", s.sidebarCollapsed ? "0" : "1");
      return { sidebarCollapsed: !s.sidebarCollapsed };
    }),
  setDebug: (debug) => set({ debug }),
  setDeadlineDays: (deadlineDays) => set({ deadlineDays }),
  setProgress: (progress) => set({ progress }),
  setWatchedPath: (watchedPath) => set({ watchedPath }),
  setFilesChanged: (filesChanged) => set({ filesChanged }),
  setMonitoringSearch: (monitoringSearch) => set({ monitoringSearch }),

  toast: (kind, message) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  refreshResults: async () => {
    set({ loadingResults: true });
    try {
      const { runId, results } = await api.latestResults();
      set({ runId, results, loadingResults: false });
    } catch {
      set({ loadingResults: false });
    }
  },
  refreshAnnotations: async () => {
    try {
      const list = await api.annotations();
      const map: Record<string, Annotation> = {};
      for (const a of list) map[a.fa_ref] = a;
      set({ annotations: map });
    } catch {
      /* non-fatal */
    }
  },
}));
