/**
 * Dashboard v4 — centre de l'app. Lisible en 10 secondes :
 * anneau d'avancement animé, KPIs avec deltas vs analyse précédente,
 * carte Europe centrale, "À traiter en priorité".
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MailCheck, MailQuestion, PackageX, Flame,
  ArrowRight, UploadCloud, ChevronRight,
} from "lucide-react";
import type { StoredSummary } from "../api";
import { api } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Card, KpiCard, Skeleton, StatusBadge } from "../components/ui";
import { BreakdownBars, CompletionDonut, ProgressRing, QtyBars, TopCities } from "../components/charts";
import { EuropeMap } from "../components/EuropeMap";
import { useStaggerIn } from "../anim";

/** Prochaine action synthétique d'une FA (affichage uniquement — la logique vit dans core/server). */
export function faNextAction(r: StoredSummary, t: ReturnType<typeof useT>): string {
  if (r.error || r.closureStatus === "blocked") return t("dash.checkFile");
  if (r.kpis.openResponses > 0) {
    const top = r.soldToSummaries.find((s) => s.formStatus === "open" || s.formStatus === "review");
    return top ? t(`action.${top.nextAction}` as never) : t("action.send-notif-2");
  }
  if (r.kpis.qtyMissing > 0) return t("action.chase-return");
  return t("action.none");
}

function EmptyDashboard() {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent">
        <UploadCloud size={28} strokeWidth={1.6} />
      </div>
      <div>
        <div className="text-[18px] font-semibold text-ink">{t("misc.empty.title")}</div>
        <div className="mt-1 max-w-sm text-[13px] text-muted">{t("misc.empty.body")}</div>
      </div>
      <button
        onClick={() => nav("/sources")}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-medium text-white shadow-[var(--shadow)] transition-opacity hover:opacity-90"
      >
        {t("misc.empty.cta")} <ArrowRight size={15} />
      </button>
    </div>
  );
}

/** Agrégation compacte par pays : FA, prêtes, ouvertes, qté, taux (barre). */
function CountryTable({ results, onPick }: { results: StoredSummary[]; onPick: (c: string) => void }) {
  const t = useT();
  const map = new Map<string, StoredSummary[]>();
  for (const r of results) {
    const k = r.country ?? "—";
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  const rows = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  const sum = (fas: StoredSummary[], f: (r: StoredSummary) => number) => fas.reduce((a, r) => a + f(r), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-faint">
            {[t("mgr.countryCol"), t("kpi.fas"), t("kpi.ready"), t("mon.open"), t("mon.qtyMissing"), t("kpi.completion")].map((h) => (
              <th key={h} className="pb-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([country, fas]) => {
            const expected = sum(fas, (r) => r.kpis.expectedResponses);
            const answered = sum(fas, (r) => r.kpis.formsReceived + r.kpis.closedByGfe);
            const rate = expected ? answered / expected : 0;
            const open = sum(fas, (r) => r.kpis.openResponses);
            const qty = sum(fas, (r) => r.kpis.qtyMissing);
            return (
              <tr
                key={country}
                onClick={() => onPick(country)}
                className="cursor-pointer border-t border-line/60 transition-colors hover:bg-surface-2/60"
              >
                <td className="py-2 font-semibold text-ink">{country}</td>
                <td className="py-2 font-data tabular-nums">{fas.length}</td>
                <td className="py-2 font-data tabular-nums text-ok">{fas.filter((r) => r.closureStatus === "ready").length}</td>
                <td className={`py-2 font-data tabular-nums ${open ? "text-warn" : "text-faint"}`}>{open}</td>
                <td className={`py-2 font-data tabular-nums ${qty ? "text-mid" : "text-faint"}`}>{qty}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(rate * 100)}%` }} />
                    </div>
                    <span className="font-data text-[11px] tabular-nums text-muted">{Math.round(rate * 100)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Overview() {
  const t = useT();
  const nav = useNavigate();
  const { results, runId, loadingResults, setMonitoringSearch } = useAppStore();
  const staggerRef = useStaggerIn([results]);
  // deltas vs analyse précédente (silencieux si une seule analyse existe)
  const [deltas, setDeltas] = useState<{ open: number; qty: number } | null>(null);
  useEffect(() => {
    void api
      .diff()
      .then(({ diff }) => {
        let open = 0, qty = 0;
        for (const d of diff) {
          if (d.before && d.after) {
            open += d.after.openResponses - d.before.openResponses;
            qty += d.after.qtyMissing - d.before.qtyMissing;
          }
        }
        setDeltas({ open, qty });
      })
      .catch(() => setDeltas(null));
  }, [runId]);

  if (loadingResults) {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (runId === null || results.length === 0) return <EmptyDashboard />;

  const count = (s: string) => results.filter((r) => r.closureStatus === s).length;
  const sum = (f: (r: StoredSummary) => number) => results.reduce((a, r) => a + f(r), 0);
  const expected = sum((r) => r.kpis.expectedResponses);
  const answered = sum((r) => r.kpis.formsReceived + r.kpis.closedByGfe);
  const openFas = results.length - count("ready");
  const critical = results.filter((r) => r.critical).length;

  const attention = results
    .filter((r) => r.closureStatus !== "ready")
    .sort(
      (a, b) =>
        Number(b.critical) - Number(a.critical) ||
        Number(!!b.error) - Number(!!a.error) ||
        b.kpis.openResponses - a.kpis.openResponses
    )
    .slice(0, 4);

  const statusEntries = [
    { label: t("status.ready"), value: count("ready") },
    { label: t("status.waiting-forms"), value: count("waiting-forms") },
    { label: t("status.waiting-reconciliation"), value: count("waiting-reconciliation") },
    { label: t("status.blocked"), value: count("blocked") },
  ];

  return (
    <div ref={staggerRef} className="flex flex-col gap-3">
      {/* ---- KPIs héro : anneau taux de clôture + 4 stat-cards à tendance ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <ProgressRing
          ratio={results.length ? count("ready") / results.length : null}
          label={t("dash.closureRate")}
          sub={`${count("ready")}/${results.length} ${t("kpi.fas")}`}
        />
        <KpiCard
          label={t("kpi.completion")}
          value={expected ? Math.round((answered / expected) * 100) : 0}
          format={(v) => `${Math.round(v)}%`}
          tone="accent" icon={<MailCheck size={19} strokeWidth={2} />}
          sub={`${answered}/${expected}`}
        />
        <KpiCard
          label={t("kpi.openResponses")} value={sum((r) => r.kpis.openResponses)}
          tone={sum((r) => r.kpis.openResponses) ? "warn" : "ok"}
          trend={{ delta: deltas?.open ?? null, goodWhenDown: true }}
          sub={t("dash.openSub")}
          icon={<MailQuestion size={19} strokeWidth={2} />}
        />
        <KpiCard
          label={t("kpi.qtyMissing")} value={sum((r) => r.kpis.qtyMissing)}
          tone={sum((r) => r.kpis.qtyMissing) ? "mid" : "ok"}
          trend={{ delta: deltas?.qty ?? null, goodWhenDown: true }}
          sub={t("dash.qtySub")} icon={<PackageX size={19} strokeWidth={2} />}
        />
        <KpiCard
          label={t("kpi.critical")} value={critical} tone={critical ? "bad" : "ok"}
          sub={critical ? t("dash.criticalSub") : t("prio.allClear")} icon={<Flame size={19} strokeWidth={2} />}
        />
      </div>

      {/* ---- carte centrale + colonne décision ---- */}
      <div className="grid gap-3 lg:grid-cols-5">
        <Card title={t("map.title")} className="anim-item lg:col-span-3">
          <EuropeMap results={results} />
        </Card>
        <div className="flex flex-col gap-3 lg:col-span-2">
          <Card
            title={t("dash.priorityBlock")}
            className="anim-item"
            right={
              <button onClick={() => nav("/priority")} className="flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline">
                {t("dash.seeAll")} <ChevronRight size={12} />
              </button>
            }
          >
            {attention.length === 0 ? (
              <div className="py-6 text-center text-[12.5px] text-ok">{t("prio.allClear")}</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {attention.map((r) => (
                  <button
                    key={r.fileHash}
                    onClick={() => nav(`/fa/${r.fileHash}`)}
                    className="flex items-center gap-2.5 rounded-xl bg-surface-2/60 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    {r.critical && <Flame size={13} className="shrink-0 text-bad" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-data text-[12px] font-semibold text-ink">{r.faRef}</span>
                        <StatusBadge status={r.closureStatus} />
                      </div>
                      {r.deviceHint && (
                        <div className="mt-0.5 truncate text-[10.5px] text-faint">{r.deviceHint}</div>
                      )}
                    </div>
                    <span className="hidden shrink-0 text-right text-[11.5px] text-muted xl:block">
                      {faNextAction(r, t)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
          <Card title={t("overview.completionTitle")} className="anim-item">
            <CompletionDonut results={results} />
          </Card>
        </div>
      </div>

      {/* ---- suivi par pays ---- */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title={t("dash.byCountry")} className="anim-item lg:col-span-2">
          <CountryTable results={results} onPick={(c) => { setMonitoringSearch(c); nav("/monitoring"); }} />
        </Card>
        <Card title={t("overview.statusBreakdown")} className="anim-item">
          <BreakdownBars entries={statusEntries} />
        </Card>
      </div>

      {/* ---- détail visuel ---- */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card title={t("overview.byType")} className="anim-item">
          <BreakdownBars
            color="var(--accent)"
            entries={(["recall", "correction", "advisory", "recall-correction"] as const)
              .map((ty) => ({ label: t(`type.${ty}` as never), value: results.filter((r) => r.faType === ty).length }))
              .filter((e) => e.value > 0)}
          />
        </Card>
        <Card title={t("overview.qtyTitle")} className="anim-item">
          <QtyBars results={results} />
        </Card>
        <Card title={t("overview.topCities")} className="anim-item md:col-span-2 xl:col-span-1">
          <TopCities results={results} />
        </Card>
      </div>
    </div>
  );
}
