/** FA detail: KPIs, Sold To table, paginated lines, quality, follow-up. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, ChevronLeft, ChevronRight, FileSpreadsheet } from "lucide-react";
import type { FaLine, SoldToSummary } from "@facm/core";
import { api } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { DataTable } from "../components/DataTable";
import { Sparkline } from "../components/charts";
import { Button, Card, EmptyState, FormBadge, KpiCard, Select, Skeleton, StatusBadge } from "../components/ui";
import { num, pct, shortDate } from "../format";

const MANUAL_STATUSES = ["", "relance", "attente-client", "escalade", "suivi-ok"] as const;
const PAGE = 100;

export function FaDetail() {
  const t = useT();
  const nav = useNavigate();
  const { faId } = useParams<{ faId: string }>();
  const { results, annotations, refreshAnnotations, toast, debug } = useAppStore();
  // faId is the file hash (unique even when two files share the same FA ref)
  const fa = results.find((r) => r.fileHash === faId) ?? results.find((r) => r.faRef === faId);

  const [tab, setTab] = useState<"summary" | "soldtos" | "lines" | "quality" | "notes">("summary");
  const [lineFilter, setLineFilter] = useState<"active" | "all" | "blocking" | "open">("active");
  const [offset, setOffset] = useState(0);
  const [linesData, setLinesData] = useState<{ total: number; lines: FaLine[] } | null>(null);
  const [comment, setComment] = useState("");
  const [manualStatus, setManualStatus] = useState("");
  const [history, setHistory] = useState<Array<{ at: string; open: number; qtyMissing: number; completion: number | null }> | null>(null);

  useEffect(() => {
    if (!fa) return;
    void api.faHistory(fa.faRef).then((h) => setHistory(h.points)).catch(() => setHistory(null));
  }, [fa]);

  useEffect(() => {
    const a = fa ? annotations[fa.faRef] : undefined;
    setComment(a?.comment ?? "");
    setManualStatus(a?.manual_status ?? "");
  }, [fa, annotations]);

  useEffect(() => {
    if (!fa || tab !== "lines") return;
    setLinesData(null);
    void api
      .lines(fa.analysisId, { offset, limit: PAGE, filter: lineFilter })
      .then(setLinesData)
      .catch(() => setLinesData({ total: 0, lines: [] }));
  }, [fa, tab, offset, lineFilter]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const soldToCols: ColumnDef<SoldToSummary, any>[] = useMemo(
    () => [
      { header: "Sold To", accessorKey: "soldTo", cell: ({ getValue }) => <b>{String(getValue())}</b> },
      { header: "Hospital", accessorKey: "hospitalName" },
      { header: "City", accessorKey: "city" },
      { header: t("mon.status"), accessorKey: "formStatus", cell: ({ getValue }) => <FormBadge status={getValue()} /> },
      { header: t("detail.lines"), accessorKey: "lineCount" },
      { header: "Qty ret.", accessorKey: "qtyToReturn", cell: ({ getValue }) => num(getValue()) },
      { header: "Qty reçue", accessorKey: "qtyReceived", cell: ({ getValue }) => num(getValue()) },
      {
        header: t("mon.qtyMissing"),
        accessorKey: "qtyMissing",
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return <span className={v > 0 ? "font-medium text-mid" : "text-faint"}>{num(v)}</span>;
        },
      },
      { header: "RGA ✗", accessorKey: "rgaMissingCount", cell: ({ getValue }) => (getValue() ? getValue() : "—") },
      { header: "Notif", accessorKey: "lastNotifDate", cell: ({ getValue }) => shortDate(getValue()) },
      {
        header: t("prio.nextAction"),
        accessorKey: "nextAction",
        cell: ({ getValue }) => <span className="text-muted">{t(`action.${getValue()}` as never)}</span>,
      },
    ],
    [t]
  );

  if (!fa) {
    return (
      <EmptyState
        title={t("misc.empty.title")}
        action={<Button onClick={() => nav("/monitoring")}>{t("detail.back")}</Button>}
      />
    );
  }

  const TabBtn = ({ id, label }: { id: typeof tab; label: string }) => (
    <button
      onClick={() => {
        setTab(id);
        setOffset(0);
      }}
      className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        tab === id ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => nav("/monitoring")}>
          <ArrowLeft size={14} />
        </Button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-data text-lg font-semibold text-ink">FA {fa.faRef}</h2>
            <StatusBadge status={fa.closureStatus} />
            <span className="text-[12px] text-muted">
              {t(`type.${fa.faType}` as never)} · {fa.country ?? "—"}
            </span>
          </div>
          {fa.deviceHint && <div className="mt-0.5 truncate text-[12px] text-faint">{fa.deviceHint}</div>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={() =>
              void api
                .openFile(fa.fileHash)
                .then(() => toast("info", t("mon.openExcelToast")))
                .catch((e) => toast("error", e instanceof Error ? e.message : t("misc.error")))
            }
          >
            <FileSpreadsheet size={14} className="text-ok" /> {t("mon.openExcel")}
          </Button>
        </div>
        {debug && (
          <span className="w-full rounded bg-surface-2 px-2 py-0.5 text-[10.5px] text-faint">
            {fa.fileName} · sheet: {fa.sheetUsed} · header L{fa.headerRow} · {fa.fromCache ? "cache" : "fresh"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard label={t("kpi.expected")} value={fa.kpis.expectedResponses} tone="accent" />
        <KpiCard label={t("kpi.received")} value={fa.kpis.formsReceived} tone="ok" />
        <KpiCard label={t("kpi.gfe")} value={fa.kpis.closedByGfe} tone="accent" />
        <KpiCard label={t("kpi.openResponses")} value={fa.kpis.openResponses} tone={fa.kpis.openResponses ? "warn" : "idle"} />
        <KpiCard label={t("kpi.completion")} value={pct(fa.kpis.completionRate)} tone="ok" />
        <KpiCard
          label={t("kpi.qtyMissing")}
          value={fa.kpis.qtyMissing}
          sub={fa.kpis.excludedLines > 0 ? `${fa.kpis.excludedLines} ${t("misc.excluded")}` : undefined}
          tone={fa.kpis.qtyMissing ? "mid" : "idle"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-line pb-2">
        <TabBtn id="summary" label={t("detail.summary")} />
        <TabBtn id="soldtos" label={t("detail.soldTos")} />
        <TabBtn id="lines" label={`${t("detail.lines")} (${fa.kpis.totalLines})`} />
        <TabBtn id="quality" label={`${t("detail.quality")} (${fa.quality.filter((q) => q.severity !== "info").length})`} />
        <TabBtn id="notes" label={t("detail.notes")} />
      </div>

      {tab === "summary" && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title={t("detail.trend")}>
            {history && history.length >= 2 ? (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("kpi.openResponses")}</span>
                    <span className="font-data text-[15px] font-bold text-warn">{history.at(-1)!.open}</span>
                  </div>
                  <Sparkline values={history.map((p) => p.open)} color="var(--orange)" w={220} />
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("kpi.qtyMissing")}</span>
                    <span className="font-data text-[15px] font-bold text-mid">{history.at(-1)!.qtyMissing}</span>
                  </div>
                  <Sparkline values={history.map((p) => p.qtyMissing)} color="var(--yellow)" w={220} />
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("kpi.completion")}</span>
                    <span className="font-data text-[15px] font-bold text-ok">{pct(history.at(-1)!.completion)}</span>
                  </div>
                  <Sparkline values={history.map((p) => (p.completion ?? 0) * 100)} color="var(--green)" w={220} />
                </div>
                <div className="text-[10.5px] text-faint">{history.length} {t("detail.trendRuns")}</div>
              </div>
            ) : (
              <div className="py-8 text-center text-[12px] text-faint">{t("detail.trendEmpty")}</div>
            )}
          </Card>
          <Card title={t("detail.blockReason")}>
            <div className="flex flex-col gap-3">
              <div className="text-[13.5px] leading-relaxed text-ink">
                {fa.error
                  ? fa.error
                  : fa.closureStatus === "waiting-forms"
                    ? t("detail.reason.forms", { n: fa.kpis.openResponses })
                    : fa.closureStatus === "waiting-reconciliation"
                      ? t("detail.reason.recon", { n: fa.kpis.qtyMissing })
                      : fa.closureStatus === "blocked"
                        ? t("detail.reason.blocked")
                        : t("detail.reason.ready")}
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                  {t("prio.nextAction")}
                </span>
                <span className="text-[13px] font-medium text-ink">
                  {fa.closureStatus === "ready"
                    ? t("action.none")
                    : fa.kpis.openResponses > 0
                      ? t(`action.${fa.soldToSummaries.find((s) => s.formStatus === "open" || s.formStatus === "review")?.nextAction ?? "send-notif-2"}` as never)
                      : fa.kpis.qtyMissing > 0
                        ? t("action.chase-return")
                        : t("dash.checkFile")}
                </span>
              </div>
              {fa.kpis.rgaMissingCount > 0 && (
                <div className="text-[12px] text-muted">
                  {fa.kpis.rgaMissingCount} {t("kpi.rgaMissing")} — {t("detail.rgaNote")}
                </div>
              )}
            </div>
          </Card>
          <Card title={t("detail.topClients")}>
            {fa.soldToSummaries.filter((s) => s.formStatus === "open" || s.formStatus === "review" || s.qtyMissing > 0).length === 0 ? (
              <div className="py-6 text-center text-[12.5px] text-ok">{t("prio.allClear")}</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {fa.soldToSummaries
                  .filter((s) => s.formStatus === "open" || s.formStatus === "review" || s.qtyMissing > 0)
                  .slice(0, 6)
                  .map((s) => (
                    <div key={s.soldTo} className="flex items-center gap-2.5 rounded-xl bg-surface-2/60 px-3 py-2">
                      <span className="font-data w-16 shrink-0 text-[12px] font-semibold text-ink">{s.soldTo}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{s.hospitalName}</span>
                      <FormBadge status={s.formStatus} />
                      <span className="hidden shrink-0 text-[11.5px] text-muted md:block">
                        {t(`action.${s.nextAction}` as never)}
                      </span>
                    </div>
                  ))}
                <button
                  onClick={() => setTab("soldtos")}
                  className="mt-1 self-start text-[11.5px] font-medium text-accent hover:underline"
                >
                  {t("dash.seeAll")}
                </button>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "soldtos" && (
        <DataTable data={fa.soldToSummaries} columns={soldToCols} searchPlaceholder={t("mon.search")} initialPageSize={25} />
      )}

      {tab === "lines" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            {(["active", "all", "blocking", "open"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setLineFilter(f);
                  setOffset(0);
                }}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                  lineFilter === f ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {t(`detail.filter.${f}` as never)}
              </button>
            ))}
            {linesData && (
              <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
                {offset + 1}–{Math.min(offset + PAGE, linesData.total)} / {linesData.total}
                <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  <ChevronLeft size={13} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={offset + PAGE >= linesData.total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  <ChevronRight size={13} />
                </Button>
              </span>
            )}
          </div>
          {!linesData ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60 text-left text-[10.5px] uppercase tracking-wider text-muted">
                    {["Row", "Sold To", "Hospital", "City", "Material", "Batch", "Form", t("mon.status"), "Qty ret.", "Qty DC", "Miss.", "RGA", "Notif 2", "Notif 3"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2.5 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linesData.lines.map((l) => (
                    <tr key={l.row} className="border-b border-line last:border-0">
                      <td className="px-2.5 py-1.5 text-faint">{l.row}</td>
                      <td className="px-2.5 py-1.5 font-medium text-ink">{l.soldToRaw}</td>
                      <td className="max-w-52 truncate px-2.5 py-1.5 text-muted" title={l.hospitalName}>{l.hospitalName}</td>
                      <td className="px-2.5 py-1.5 text-muted">{l.city}</td>
                      <td className="px-2.5 py-1.5">{l.materialNumber}</td>
                      <td className="px-2.5 py-1.5">{l.batchNumber}</td>
                      <td className="px-2.5 py-1.5">{l.form || "—"}</td>
                      <td className="px-2.5 py-1.5"><FormBadge status={l.formStatus} /></td>
                      <td className="px-2.5 py-1.5 tabular-nums">{num(l.qtyToReturn)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{num(l.qtyReceivedEffective)}</td>
                      <td className={`px-2.5 py-1.5 tabular-nums ${l.qtyMissing > 0 ? "font-medium text-mid" : "text-faint"}`}>{l.qtyMissing}</td>
                      <td className="px-2.5 py-1.5">{l.rgaMissing ? <span className="text-mid">✗</span> : l.rga || "—"}</td>
                      <td className="px-2.5 py-1.5 text-muted">{shortDate(l.notif2Date)}</td>
                      <td className="px-2.5 py-1.5 text-muted">{shortDate(l.notif3Date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "quality" && (
        <Card>
          {fa.quality.filter((q) => q.severity !== "info").length === 0 ? (
            <div className="text-[12.5px] text-ok">{t("dq.clean")}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {fa.quality
                .filter((q) => q.severity !== "info")
                .map((q, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
                    <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${q.severity === "error" ? "bg-bad" : "bg-warn"}`} />
                    <div>
                      <span className="text-ink">{q.message}</span>
                      {q.detail && <span className="ml-2 text-faint">({q.detail})</span>}
                    </div>
                  </div>
                ))}
            </div>
          )}
          {/* détail technique (mapping colonnes) : réservé au mode debug */}
          {debug && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">{t("dq.mapping")}</div>
              <div className="grid gap-1 md:grid-cols-2">
                {Object.entries(fa.columnMapping).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-[12px]">
                    <span className="text-faint">{v}</span>
                    <span className="text-line-strong">→</span>
                    <span className="text-ink">{k}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "notes" && (
        <Card className="max-w-xl">
          <div className="flex flex-col gap-3">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted">{t("detail.manualStatus")}</label>
            <Select value={manualStatus} onChange={(e) => setManualStatus(e.target.value)} className="w-56">
              {MANUAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`ms.${s || "none"}` as never)}
                </option>
              ))}
            </Select>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted">{t("detail.comment")}</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <Button
              variant="primary"
              className="self-start"
              onClick={() =>
                void api.saveAnnotation(fa.faRef, comment || null, manualStatus || null).then(() => {
                  void refreshAnnotations();
                  toast("success", t("detail.saved"));
                })
              }
            >
              {t("detail.save")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
