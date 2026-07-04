/** Analysis history + diff between the two latest runs. */
import { useEffect, useState } from "react";
import type { FaDiffEntry } from "../api";
import { api } from "../api";
import { useT } from "../i18n";
import { Card, EmptyState, Skeleton } from "../components/ui";

export function History() {
  const t = useT();
  const [runs, setRuns] = useState<Array<Record<string, unknown>> | null>(null);
  const [diff, setDiff] = useState<FaDiffEntry[] | null>(null);
  const [diffError, setDiffError] = useState(false);

  useEffect(() => {
    void api.runs(30).then(setRuns).catch(() => setRuns([]));
    void api
      .diff()
      .then((d) => setDiff(d.diff))
      .catch(() => setDiffError(true));
  }, []);

  const KIND_TONE: Record<FaDiffEntry["kind"], string> = {
    added: "text-ok bg-ok-soft",
    removed: "text-faint bg-idle-soft",
    "status-changed": "text-accent bg-accent-soft",
    "kpi-changed": "text-warn bg-warn-soft",
    unchanged: "text-faint bg-idle-soft",
  };

  const changes = (diff ?? []).filter((d) => d.kind !== "unchanged");

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("hist.diffTitle")}>
        {diffError ? (
          <div className="text-[12.5px] text-muted">{t("hist.noChanges")}</div>
        ) : diff === null ? (
          <Skeleton className="h-16" />
        ) : changes.length === 0 ? (
          <div className="text-[12.5px] text-muted">{t("hist.noChanges")}</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {changes.map((d) => (
              <div key={d.faRef + d.kind} className="flex items-center gap-3 text-[12.5px]">
                <span className={`w-32 shrink-0 rounded-full px-2 py-0.5 text-center text-[10.5px] font-medium ${KIND_TONE[d.kind]}`}>
                  {t(`hist.${d.kind}` as never)}
                </span>
                <span className="w-24 font-medium text-ink">{d.faRef}</span>
                {d.before && d.after && d.before.closureStatus !== d.after.closureStatus && (
                  <span className="text-muted">
                    {t(`status.${d.before.closureStatus}` as never)} → <b className="text-ink">{t(`status.${d.after.closureStatus}` as never)}</b>
                  </span>
                )}
                {d.before && d.after && d.before.openResponses !== d.after.openResponses && (
                  <span className="text-muted">
                    open {d.before.openResponses} → <b className="text-ink">{d.after.openResponses}</b>
                  </span>
                )}
                {d.before && d.after && d.before.qtyMissing !== d.after.qtyMissing && (
                  <span className="text-muted">
                    qty {d.before.qtyMissing} → <b className="text-ink">{d.after.qtyMissing}</b>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t("hist.title")}>
        {runs === null ? (
          <Skeleton className="h-32" />
        ) : runs.length === 0 ? (
          <EmptyState title={t("misc.empty.title")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wider text-muted">
                  {["#", "Date", "Mode", "Source", "Statut", "Stats"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const stats = r.stats_json ? JSON.parse(String(r.stats_json)) : null;
                  return (
                    <tr key={String(r.id)} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-faint">{String(r.id)}</td>
                      <td className="px-3 py-2">{new Date(String(r.started_at)).toLocaleString()}</td>
                      <td className="px-3 py-2 text-muted">{String(r.mode)}</td>
                      <td className="max-w-72 truncate px-3 py-2 text-muted" title={String(r.source ?? "")}>
                        {String(r.source ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                          r.status === "done" ? "bg-ok-soft text-ok" : r.status === "error" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"
                        }`}>
                          {String(r.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {stats ? `${stats.total ?? "—"} fichiers · ${stats.fromCache ?? 0} cache · ${stats.errors ?? 0} err` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
