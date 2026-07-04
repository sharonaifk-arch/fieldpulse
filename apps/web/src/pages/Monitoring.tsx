/** Monitoring : filtres rapides par statut, prochaine action, détail au clic. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import type { StoredSummary } from "../api";
import { api } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { DataTable } from "../components/DataTable";
import { EmptyState, StatusBadge, Select, Button } from "../components/ui";
import { faNextAction } from "./Overview";
import { pct } from "../format";

const MANUAL_STATUSES = ["", "relance", "attente-client", "escalade", "suivi-ok"] as const;

type QuickFilter = "all" | "critical" | "waiting-forms" | "waiting-reconciliation" | "ready" | "blocked";
const QUICK_FILTERS: QuickFilter[] = ["all", "critical", "waiting-forms", "waiting-reconciliation", "ready", "blocked"];

type TypeFilter = "all" | "recall" | "correction" | "advisory" | "recall-correction";
const TYPE_FILTERS: TypeFilter[] = ["all", "recall", "correction", "advisory", "recall-correction"];

export function Monitoring() {
  const t = useT();
  const nav = useNavigate();
  const { results, runId, annotations, refreshAnnotations, toast, monitoringSearch, setMonitoringSearch } = useAppStore();
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  // recherche pré-remplie par la carte Europe, consommée une fois
  const presetSearch = monitoringSearch;
  useEffect(() => {
    if (monitoringSearch) setMonitoringSearch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let out = results;
    if (typeFilter !== "all") out = out.filter((r) => r.faType === typeFilter);
    if (quickFilter === "critical") out = out.filter((r) => r.critical);
    else if (quickFilter !== "all") out = out.filter((r) => r.closureStatus === quickFilter);
    return out;
  }, [results, quickFilter, typeFilter]);

  const countFor = (f: QuickFilter): number =>
    f === "all" ? results.length : f === "critical" ? results.filter((r) => r.critical).length
      : results.filter((r) => r.closureStatus === f).length;

  if (runId === null || results.length === 0) {
    return (
      <EmptyState
        title={t("misc.empty.title")}
        body={t("misc.empty.body")}
        action={<Button variant="primary" onClick={() => nav("/sources")}>{t("nav.sources")}</Button>}
      />
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: ColumnDef<StoredSummary, any>[] = [
    {
      header: "FA",
      accessorKey: "faRef",
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 font-medium text-ink">
          {row.original.critical && <AlertTriangle size={12} className="text-warn" />}
          {row.original.faRef}
        </span>
      ),
    },
    {
      header: t("mon.device"),
      accessorKey: "deviceHint",
      cell: ({ getValue }) => (
        <span className="block max-w-56 truncate text-muted" title={String(getValue() ?? "")}>
          {(getValue() as string | null) ?? "—"}
        </span>
      ),
    },
    {
      header: t("mon.file"),
      accessorKey: "fileName",
      cell: ({ getValue }) => (
        <span className="block max-w-64 truncate text-muted" title={String(getValue())}>
          {String(getValue())}
        </span>
      ),
    },
    {
      header: t("mon.type"),
      accessorKey: "faType",
      cell: ({ getValue }) => <span className="text-muted">{t(`type.${getValue()}` as never)}</span>,
    },
    { header: t("mon.country"), accessorKey: "country", cell: ({ getValue }) => getValue() ?? "—" },
    {
      header: t("mon.status"),
      accessorKey: "closureStatus",
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    },
    {
      header: t("mon.responses"),
      id: "responses",
      accessorFn: (r) => r.kpis.formsReceived + r.kpis.closedByGfe,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.kpis.formsReceived + row.original.kpis.closedByGfe}/{row.original.kpis.expectedResponses}
        </span>
      ),
    },
    {
      header: t("mon.completion"),
      id: "completion",
      accessorFn: (r) => r.kpis.completionRate ?? -1,
      cell: ({ row }) => <span className="tabular-nums">{pct(row.original.kpis.completionRate)}</span>,
    },
    {
      header: t("mon.open"),
      id: "open",
      accessorFn: (r) => r.kpis.openResponses,
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={`tabular-nums ${v > 0 ? "font-medium text-warn" : "text-faint"}`}>{v}</span>;
      },
    },
    {
      header: t("mon.qtyMissing"),
      id: "qtyMissing",
      accessorFn: (r) => r.kpis.qtyMissing,
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={`tabular-nums ${v > 0 ? "font-medium text-mid" : "text-faint"}`}>{v}</span>;
      },
    },
    {
      header: t("mon.nextAction"),
      id: "nextAction",
      accessorFn: (r) => faNextAction(r, t),
      cell: ({ getValue }) => <span className="text-[12px] text-muted">{String(getValue())}</span>,
    },
    {
      header: "",
      id: "openFile",
      enableSorting: false,
      cell: ({ row }) => (
        <button
          title={t("mon.openExcel")}
          onClick={(e) => {
            e.stopPropagation();
            void api
              .openFile(row.original.fileHash)
              .then(() => toast("info", t("mon.openExcelToast")))
              .catch((err) => toast("error", err instanceof Error ? err.message : t("misc.error")));
          }}
          className="rounded-lg p-1.5 text-faint transition-colors hover:bg-ok-soft hover:text-ok"
        >
          <FileSpreadsheet size={15} />
        </button>
      ),
    },
    {
      header: t("mon.manualStatus"),
      id: "manual",
      accessorFn: (r) => annotations[r.faRef]?.manual_status ?? "",
      cell: ({ row }) => (
        <Select
          value={annotations[row.original.faRef]?.manual_status ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value || null;
            void api
              .saveAnnotation(row.original.faRef, annotations[row.original.faRef]?.comment ?? null, v)
              .then(() => {
                void refreshAnnotations();
                toast("success", t("detail.saved"));
              });
          }}
          className="!py-0.5 text-[11.5px]"
        >
          {MANUAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`ms.${s || "none"}` as never)}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* filtres rapides */}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_FILTERS.map((f) => {
          const n = countFor(f);
          const active = quickFilter === f;
          return (
            <button
              key={f}
              onClick={() => setQuickFilter(f)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                active ? "bg-accent text-white" : "bg-surface text-muted shadow-[var(--shadow)] hover:text-ink"
              }`}
            >
              {t(`mon.filter.${f}` as never)}
              <span className={`font-data text-[11px] ${active ? "text-white/80" : "text-faint"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* filtre par type de FA */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TYPE_FILTERS.map((f) => {
          const n = f === "all" ? results.length : results.filter((r) => r.faType === f).length;
          if (f !== "all" && n === 0) return null;
          const active = typeFilter === f;
          return (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                active ? "bg-ink text-surface" : "bg-surface-2 text-muted hover:text-ink"
              }`}
            >
              {f === "all" ? t("mon.allTypes") : t(`type.${f}` as never)}
              <span className="font-data text-[10.5px] opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchPlaceholder={t("mon.search")}
        onRowClick={(r) => nav(`/fa/${r.fileHash}`)}
        emptyMessage={t("mon.noResults")}
        initialSearch={presetSearch ?? undefined}
        initialHidden={["fileName", "completion"]}
      />
    </div>
  );
}
