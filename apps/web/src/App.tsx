import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { usePageEnter } from "./anim";
import { Header, Sidebar } from "./components/layout";
import { Skeleton, ToastHost } from "./components/ui";
import { api, subscribe, type RunProgress } from "./api";
import { useAppStore } from "./store";
import { Overview } from "./pages/Overview";

// pages secondaires en lazy-load : le dashboard reste instantané
const Sources = lazy(() => import("./pages/Sources").then((m) => ({ default: m.Sources })));
const Monitoring = lazy(() => import("./pages/Monitoring").then((m) => ({ default: m.Monitoring })));
const PriorityFocus = lazy(() => import("./pages/PriorityFocus").then((m) => ({ default: m.PriorityFocus })));
const FaDetail = lazy(() => import("./pages/FaDetail").then((m) => ({ default: m.FaDetail })));
const DataQuality = lazy(() => import("./pages/DataQuality").then((m) => ({ default: m.DataQuality })));
const ExportsPage = lazy(() => import("./pages/ExportsPage").then((m) => ({ default: m.ExportsPage })));
const History = lazy(() => import("./pages/History").then((m) => ({ default: m.History })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

function PageFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}

/** Transition d'entrée à chaque changement de route (fade+slide 220ms). */
function PageContainer({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const ref = usePageEnter(pathname);
  return (
    <main className="flex-1 px-4 py-4 md:px-6">
      <div ref={ref}>{children}</div>
    </main>
  );
}

export default function App() {
  const {
    theme, setTheme, setProgress, refreshResults, refreshAnnotations,
    setWatchedPath, setFilesChanged, setDebug, setDeadlineDays, setLang, toast,
  } = useAppStore();

  // initial state: theme class, server settings, latest results, SSE streams
  useEffect(() => {
    setTheme(theme);
    void api
      .settings()
      .then((s) => {
        setDeadlineDays(s.deadlineDays);
        setDebug(s.debug);
        if (!localStorage.getItem("facm.lang")) setLang(s.language as "fr" | "en");
      })
      .catch(() => {});
    void refreshResults();
    void refreshAnnotations();
    void api.watchStatus().then((w) => setWatchedPath(w.path)).catch(() => {});

    const offRuns = subscribe("/api/runs/events", {
      progress: (d) => setProgress(d as RunProgress),
      "run-done": () => {
        void refreshResults();
        toast("success", "Analyse terminée");
      },
      "run-error": (d) => toast("error", String((d as { error?: string }).error ?? "run error")),
    });
    const offWatch = subscribe("/api/watch/events", {
      "files-changed": () => setFilesChanged(true),
    });
    return () => {
      offRuns();
      offWatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <HashRouter>
      <Sidebar />
      <div
        className={`flex min-h-full flex-col transition-[margin] duration-300 ease-out ${
          sidebarCollapsed ? "ml-14" : "ml-14 lg:ml-56"
        }`}
      >
        <Header />
        <PageContainer>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/monitoring" element={<Monitoring />} />
              <Route path="/priority" element={<PriorityFocus />} />
              <Route path="/fa/:faId" element={<FaDetail />} />
              <Route path="/quality" element={<DataQuality />} />
              <Route path="/exports" element={<ExportsPage />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </PageContainer>
      </div>
      <ToastHost />
    </HashRouter>
  );
}
