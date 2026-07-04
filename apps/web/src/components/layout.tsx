/** App shell v4 : sidebar coulissante (toggle animé) + header épuré. */
import { NavLink, useLocation } from "react-router-dom";
import {
  Database, LayoutDashboard, Table2, Flame, ShieldAlert, Download,
  History, Settings, Moon, Sun, RefreshCw, Radio, Activity,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Button } from "./ui";

const NAV = [
  { to: "/sources", icon: Database, key: "nav.sources" },
  { to: "/", icon: LayoutDashboard, key: "nav.overview" },
  { to: "/monitoring", icon: Table2, key: "nav.monitoring" },
  { to: "/priority", icon: Flame, key: "nav.priority" },
  { to: "/quality", icon: ShieldAlert, key: "nav.quality" },
  { to: "/exports", icon: Download, key: "nav.exports" },
  { to: "/history", icon: History, key: "nav.history" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
] as const;

export function Sidebar() {
  const t = useT();
  const { results, sidebarCollapsed, toggleSidebar } = useAppStore();
  // badges = vraies alertes uniquement
  const errors = results.filter((r) => r.error || r.closureStatus === "blocked").length;
  const critical = results.filter((r) => r.critical).length;
  // < lg : toujours compacte ; ≥ lg : coulisse selon le toggle
  const wide = !sidebarCollapsed;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-sidebar transition-[width] duration-300 ease-out ${
        wide ? "w-14 lg:w-56" : "w-14"
      }`}
    >
      {/* logo bicolore façon DashStack : Field blanc + Pulse vert battement */}
      <div className="flex items-center gap-2.5 px-3 py-5 lg:px-4">
        <Activity size={20} strokeWidth={2.4} className="shrink-0 text-pulse" />
        <div className={`min-w-0 ${wide ? "hidden lg:block" : "hidden"}`}>
          <span className="text-[17px] font-extrabold tracking-tight text-sidebar-text">Field</span>
          <span className="text-[17px] font-extrabold tracking-tight text-pulse">Pulse</span>
        </div>
      </div>
      <nav className="mt-1 flex flex-1 flex-col gap-1 px-2.5">
        {NAV.map(({ to, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={t(key)}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-accent text-white shadow-[0_6px_14px_rgba(72,128,255,0.35)]"
                  : "text-sidebar-text/75 hover:bg-sidebar-hover hover:text-sidebar-text"
              }`
            }
          >
            <Icon size={16} strokeWidth={2} className="shrink-0" />
            <span className={`truncate ${wide ? "hidden lg:block" : "hidden"}`}>{t(key)}</span>
            {key === "nav.quality" && errors > 0 && (
              <span className={`rounded-full bg-bad px-1.5 text-[10px] font-bold text-white ${wide ? "absolute right-1.5 top-1.5 lg:static lg:ml-auto" : "absolute right-1.5 top-1.5"}`}>
                {errors}
              </span>
            )}
            {key === "nav.priority" && critical > 0 && (
              <span className={`rounded-full bg-warn px-1.5 text-[10px] font-bold text-white ${wide ? "absolute right-1.5 top-1.5 lg:static lg:ml-auto" : "absolute right-1.5 top-1.5"}`}>
                {critical}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={toggleSidebar}
        title={wide ? "Réduire" : "Étendre"}
        className="mx-2.5 mb-3 hidden items-center gap-3 rounded-lg px-3 py-2.5 text-sidebar-text/60 transition-colors hover:bg-sidebar-hover hover:text-sidebar-text lg:flex"
      >
        {wide ? <PanelLeftClose size={16} strokeWidth={2} /> : <PanelLeftOpen size={16} strokeWidth={2} />}
      </button>
    </aside>
  );
}

const TITLES: Record<string, string> = {
  "/sources": "nav.sources", "/": "nav.overview", "/monitoring": "nav.monitoring",
  "/priority": "nav.priority", "/quality": "nav.quality", "/exports": "nav.exports",
  "/history": "nav.history", "/settings": "nav.settings",
};

export function Header() {
  const t = useT();
  const { pathname } = useLocation();
  const { results, runId, theme, setTheme, lang, setLang, refreshResults, loadingResults, watchedPath, filesChanged } =
    useAppStore();

  const lastRun = results.reduce<string | null>(
    (acc, r) => (acc === null || r.analyzedAt > acc ? r.analyzedAt : acc),
    null
  );
  const titleKey = TITLES[pathname] ?? (pathname.startsWith("/fa/") ? "nav.monitoring" : "nav.overview");

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur md:px-6">
      <h1 className="text-[16px] font-semibold text-ink">{t(titleKey as never)}</h1>
      {runId !== null && lastRun ? (
        <span className="hidden text-[11.5px] text-faint sm:block">
          {t("header.lastRun")} · {new Date(lastRun).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
          })}
        </span>
      ) : (
        <span className="hidden text-[11.5px] text-faint sm:block">{t("header.noData")}</span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {watchedPath && (
          <span className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] md:flex ${filesChanged ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>
            <Radio size={11} />
            {filesChanged ? t("misc.filesChanged") : t("sources.watching")}
          </span>
        )}
        <Button variant="ghost" onClick={() => void refreshResults()} aria-label={t("header.refresh")}>
          <RefreshCw size={14} className={loadingResults ? "animate-spin" : ""} />
        </Button>
        <Button variant="ghost" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
          <span className="text-[11px] font-semibold uppercase">{lang === "fr" ? "EN" : "FR"}</span>
        </Button>
        <Button variant="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("set.theme")}>
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </Button>
      </div>
    </header>
  );
}
