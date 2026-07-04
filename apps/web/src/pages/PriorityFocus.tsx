/** Priority Focus: errors, waiting FAs, critical deadlines, next actions,
 *  and a copy-paste manager summary generated client-side. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ClipboardCopy, FileWarning, Flame } from "lucide-react";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Button, Card, EmptyState, KpiCard, StatusBadge } from "../components/ui";
import { pct } from "../format";

export function PriorityFocus() {
  const t = useT();
  const nav = useNavigate();
  const { results, runId, lang } = useAppStore();
  const [copied, setCopied] = useState(false);

  const data = useMemo(() => {
    const errors = results.filter((r) => r.error || r.closureStatus === "blocked");
    const waitingForms = results.filter((r) => r.closureStatus === "waiting-forms");
    const waitingRecon = results.filter((r) => r.closureStatus === "waiting-reconciliation");
    const critical = results.filter((r) => r.critical);
    const openTotal = results.reduce((s, r) => s + r.kpis.openResponses, 0);
    const qtyMissingTotal = results.reduce((s, r) => s + r.kpis.qtyMissing, 0);
    return { errors, waitingForms, waitingRecon, critical, openTotal, qtyMissingTotal };
  }, [results]);

  if (runId === null || results.length === 0) {
    return <EmptyState title={t("misc.empty.title")} body={t("misc.empty.body")} />;
  }

  const nextActionFor = (r: (typeof results)[number]): string => {
    if (r.error || r.closureStatus === "blocked") return lang === "fr" ? "Vérifier la structure du fichier" : "Check file structure";
    if (r.kpis.openResponses > 0) {
      const top = r.soldToSummaries.find((s) => s.formStatus === "open" || s.formStatus === "review");
      return top ? t(`action.${top.nextAction}` as never) : t("action.send-notif-2");
    }
    if (r.kpis.qtyMissing > 0) return t("action.chase-return");
    return t("action.none");
  };

  const summaryText = useMemo(() => {
    const ready = results.filter((r) => r.closureStatus === "ready");
    const fr = lang === "fr";
    const lines = [
      fr
        ? `Point Field Actions — ${new Date().toLocaleDateString("fr-FR")}`
        : `Field Actions update — ${new Date().toLocaleDateString("en-GB")}`,
      "",
      fr
        ? `${results.length} FA suivies : ${ready.length} prêtes à clôturer, ${data.waitingForms.length} en attente de formulaires/GFE, ${data.waitingRecon.length} en attente de réconciliation${data.errors.length ? `, ${data.errors.length} fichier(s) en erreur` : ""}.`
        : `${results.length} FAs tracked: ${ready.length} ready for closure, ${data.waitingForms.length} waiting forms/GFE, ${data.waitingRecon.length} waiting reconciliation${data.errors.length ? `, ${data.errors.length} file(s) in error` : ""}.`,
      fr
        ? `Réponses ouvertes : ${data.openTotal} · Quantités manquantes : ${data.qtyMissingTotal}.`
        : `Open responses: ${data.openTotal} · Missing quantities: ${data.qtyMissingTotal}.`,
      "",
      ...results
        .filter((r) => r.closureStatus !== "ready")
        .map(
          (r) =>
            `• ${r.faRef} (${t(`type.${r.faType}` as never)}${r.country ? `, ${r.country}` : ""}) — ${t(`status.${r.closureStatus}` as never)}, ${
              fr ? "réponses" : "responses"
            } ${r.kpis.formsReceived + r.kpis.closedByGfe}/${r.kpis.expectedResponses} (${pct(r.kpis.completionRate)})${
              r.kpis.qtyMissing > 0 ? `, ${fr ? "qté manquante" : "qty missing"} ${r.kpis.qtyMissing}` : ""
            }${r.critical ? (fr ? " — CRITIQUE" : " — CRITICAL") : ""} → ${nextActionFor(r)}`
        ),
      ...(ready.length
        ? ["", fr ? `Prêtes à clôturer : ${ready.map((r) => r.faRef).join(", ")}` : `Ready for closure: ${ready.map((r) => r.faRef).join(", ")}`]
        : []),
    ];
    return lines.join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, lang, data]);

  const Section = ({ title, items, icon }: { title: string; items: typeof results; icon: React.ReactNode }) =>
    items.length === 0 ? null : (
      <Card title={title}>
        <div className="flex flex-col gap-1.5">
          {items.map((r) => (
            <button
              key={r.faRef}
              onClick={() => nav(`/fa/${r.fileHash}`)}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-left transition-colors hover:border-line-strong"
            >
              {icon}
              <span className="w-24 shrink-0 font-medium text-ink">{r.faRef}</span>
              <StatusBadge status={r.closureStatus} />
              <span className="hidden flex-1 truncate text-[12px] text-muted md:block">{r.fileName}</span>
              <span className="shrink-0 text-[12px] text-muted">
                {t("prio.nextAction")}: <b className="text-ink">{nextActionFor(r)}</b>
              </span>
            </button>
          ))}
        </div>
      </Card>
    );

  const allClear =
    data.errors.length === 0 && data.waitingForms.length === 0 && data.waitingRecon.length === 0 && data.critical.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t("prio.errors")} value={data.errors.length} tone={data.errors.length ? "bad" : "idle"} />
        <KpiCard label={t("kpi.critical")} value={data.critical.length} tone={data.critical.length ? "warn" : "idle"} />
        <KpiCard label={t("kpi.openResponses")} value={data.openTotal} tone={data.openTotal ? "warn" : "idle"} />
        <KpiCard label={t("kpi.qtyMissing")} value={data.qtyMissingTotal} tone={data.qtyMissingTotal ? "mid" : "idle"} />
      </div>

      {allClear && <EmptyState title={t("prio.allClear")} />}

      <Section title={t("prio.critical")} items={data.critical} icon={<Flame size={14} className="shrink-0 text-warn" />} />
      <Section title={t("prio.errors")} items={data.errors} icon={<FileWarning size={14} className="shrink-0 text-bad" />} />
      <Section
        title={t("prio.waitingForms")}
        items={data.waitingForms.filter((r) => !r.critical)}
        icon={<AlertTriangle size={14} className="shrink-0 text-warn" />}
      />
      <Section
        title={t("prio.waitingRecon")}
        items={data.waitingRecon}
        icon={<AlertTriangle size={14} className="shrink-0 text-mid" />}
      />

      <Card
        title={t("prio.summary")}
        right={
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(summaryText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <ClipboardCopy size={13} /> {copied ? t("prio.copied") : t("prio.copy")}
          </Button>
        }
      >
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-2/60 p-3 font-sans text-[12px] leading-relaxed text-muted">
          {summaryText}
        </pre>
      </Card>
    </div>
  );
}
