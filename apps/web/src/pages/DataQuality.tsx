/** Data Quality: only files with anomalies are expanded; clean ones stay
 *  collapsed behind a single reassuring line (spec: hidden by default). */
import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Card, EmptyState } from "../components/ui";

export function DataQuality() {
  const t = useT();
  const { results, runId, debug } = useAppStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (runId === null || results.length === 0) {
    return <EmptyState title={t("misc.empty.title")} body={t("misc.empty.body")} />;
  }

  const withIssues = results.filter((r) => r.quality.some((q) => q.severity !== "info"));
  const clean = results.filter((r) => !r.quality.some((q) => q.severity !== "info"));

  return (
    <div className="flex flex-col gap-4">
      {withIssues.length === 0 && (
        <Card>
          <div className="flex items-center gap-2.5 text-[13px] text-ok">
            <ShieldCheck size={16} /> {t("dq.clean")}
          </div>
        </Card>
      )}

      {withIssues.map((r) => (
        <Card key={r.faRef}>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-semibold text-ink">FA {r.faRef}</span>
            <span className="truncate text-[12px] text-muted">{r.fileName}</span>
            <span className="ml-auto rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-medium text-warn">
              {r.quality.filter((q) => q.severity !== "info").length} {t("dq.issues")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {r.quality
              .filter((q) => q.severity !== "info")
              .map((q, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[12.5px]">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${q.severity === "error" ? "bg-bad" : "bg-warn"}`} />
                  <div>
                    <span className="text-ink">{q.message}</span>
                    {q.detail && <span className="ml-2 text-faint">({q.detail})</span>}
                    {q.sheet && <span className="ml-2 text-faint">[{q.sheet}]</span>}
                  </div>
                </div>
              ))}
          </div>
          {/* mapping technique : réservé au mode debug (Paramètres) */}
          {debug && (
            <button
              className="mt-3 flex items-center gap-1 text-[11.5px] text-muted hover:text-ink"
              onClick={() => setExpanded((e) => ({ ...e, [r.faRef]: !e[r.faRef] }))}
            >
              {expanded[r.faRef] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t("dq.showMapping")}
            </button>
          )}
          {debug && expanded[r.faRef] && (
            <div className="mt-2 grid gap-1 border-t border-line pt-3 md:grid-cols-2">
              {Object.entries(r.columnMapping).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-[12px]">
                  <span className="text-faint">{v}</span>
                  <span className="text-line-strong">→</span>
                  <span className="text-ink">{k}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      {clean.length > 0 && withIssues.length > 0 && (
        <div className="text-[12px] text-faint">
          <ShieldCheck size={12} className="mr-1 inline" />
          {clean.map((r) => r.faRef).join(", ")} — OK
        </div>
      )}
    </div>
  );
}
