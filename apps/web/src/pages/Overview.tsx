/**
 * Dashboard v4 — centre de l'app. Lisible en 10 secondes :
 * anneau d'avancement animé, KPIs avec deltas vs analyse précédente,
 * carte Europe centrale, "À traiter en priorité".
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, MailQuestion, PackageX, Flame,
  ArrowRight, UploadCloud, ChevronRight,
} from "lucide-react";
import type { StoredSummary } from "../api";
import { api } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Card, KpiCard, Skeleton, StatusBadge } from "../components/ui";
import { BreakdownBars, CompletionDonut, DeltaBadge, ProgressRing, QtyBars, TopCities } from "../components/charts";
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

export function Overview() {
  const t = useT();
  const nav = useNavigate();
  const { results, runId, loadingResults } = useAppStore();
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
      {/* ---- KPIs héro : anneau d'avancement + 4 indicateurs à delta ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <ProgressRing
          ratio={expected ? answered / expected : null}
          label={t("dash.progress")}
          sub={`${answered}/${expected} · ${openFas}/${results.length} ${t("dash.openFas")}`}
        />
        <KpiCard
          label={t("kpi.ready")} value={count("ready")} tone="ok"
          sub={count("ready") ? t("dash.readySub") : undefined} icon={<CheckCircle2 size={17} strokeWidth={1.9} />}
        />
        <KpiCard
          label={t("kpi.openResponses")} value={sum((r) => r.kpis.openResponses)}
          tone={sum((r) => r.kpis.openResponses) ? "warn" : "ok"}
          badge={<DeltaBadge delta={deltas?.open ?? null} />}
          sub={t("dash.openSub")}
          icon={<MailQuestion size={17} strokeWidth={1.9} />}
        />
        <KpiCard
          label={t("kpi.qtyMissing")} value={sum((r) => r.kpis.qtyMissing)}
          tone={sum((r) => r.kpis.qtyMissing) ? "mid" : "ok"}
          badge={<DeltaBadge delta={deltas?.qty ?? null} />}
          sub={t("dash.qtySub")} icon={<PackageX size={17} strokeWidth={1.9} />}
        />
        <KpiCard
          label={t("kpi.critical")} value={critical} tone={critical ? "bad" : "ok"}
          sub={critical ? t("dash.criticalSub") : t("prio.allClear")} icon={<Flame size={17} strokeWidth={1.9} />}
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

      {/* ---- détail visuel ---- */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title={t("overview.statusBreakdown")} className="anim-item">
          <BreakdownBars entries={statusEntries} />
        </Card>
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
