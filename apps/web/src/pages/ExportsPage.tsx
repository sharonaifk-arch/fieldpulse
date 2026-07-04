/** Exports: async Excel/PDF jobs with download when ready. */
import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { api, withToken } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Button, Card, Checkbox, EmptyState, Select } from "../components/ui";

type JobState = { id: number; status: "pending" | "running" | "done" | "error" };

export function ExportsPage() {
  const t = useT();
  const { results, runId, toast } = useAppStore();
  const [filteredOnly, setFilteredOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [detailFa, setDetailFa] = useState("");
  const [jobs, setJobs] = useState<Record<string, JobState | null>>({ excel: null, pdf: null });

  if (runId === null || results.length === 0) {
    return <EmptyState title={t("misc.empty.title")} body={t("misc.empty.body")} />;
  }

  const start = async (kind: "excel" | "pdf") => {
    const faRefs =
      filteredOnly && statusFilter
        ? results.filter((r) => r.closureStatus === statusFilter).map((r) => r.faRef)
        : undefined;
    try {
      const { jobId } = await api.startExport({
        kind,
        runId,
        faRefs,
        detailFaRefs: detailFa ? [detailFa] : undefined,
      });
      setJobs((j) => ({ ...j, [kind]: { id: jobId, status: "running" } }));
      const poll = setInterval(() => {
        void api.exportStatus(jobId).then((s) => {
          if (s.status === "done" || s.status === "error") {
            clearInterval(poll);
            setJobs((j) => ({ ...j, [kind]: { id: jobId, status: s.status as JobState["status"] } }));
            if (s.status === "done") toast("success", t("exp.done"));
            else toast("error", `${t("exp.failed")}: ${s.error ?? ""}`);
          }
        });
      }, 1200);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : t("misc.error"));
    }
  };

  const JobButton = ({ kind }: { kind: "excel" | "pdf" }) => {
    const job = jobs[kind];
    if (job?.status === "running")
      return (
        <Button disabled>
          <Loader2 size={13} className="animate-spin" /> {t("exp.generating")}
        </Button>
      );
    if (job?.status === "done")
      return (
        <a href={withToken(`/api/exports/${job.id}/download`)} download>
          <Button variant="primary">
            <Download size={13} /> {t("exp.download")}
          </Button>
        </a>
      );
    return (
      <Button variant="primary" onClick={() => void start(kind)}>
        {t("exp.generate")}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox label={t("exp.filteredOnly")} checked={filteredOnly} onChange={setFilteredOnly} />
          {filteredOnly && (
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">—</option>
              {["ready", "waiting-forms", "waiting-reconciliation", "blocked"].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}` as never)}
                </option>
              ))}
            </Select>
          )}
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            {t("exp.detailFa")}
            <Select value={detailFa} onChange={(e) => setDetailFa(e.target.value)}>
              <option value="">—</option>
              {results.map((r) => (
                <option key={r.faRef} value={r.faRef}>
                  {r.faRef}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex flex-col items-start gap-2">
            <FileSpreadsheet size={22} strokeWidth={1.5} className="text-ok" />
            <h3 className="text-[14px] font-semibold text-ink">{t("exp.excel")}</h3>
            <p className="text-[12px] text-muted">{t("exp.excelHint")}</p>
            <div className="mt-2">
              <JobButton kind="excel" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex flex-col items-start gap-2">
            <FileText size={22} strokeWidth={1.5} className="text-bad" />
            <h3 className="text-[14px] font-semibold text-ink">{t("exp.pdf")}</h3>
            <p className="text-[12px] text-muted">{t("exp.pdfHint")}</p>
            <div className="mt-2">
              <JobButton kind="pdf" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
