/**
 * Excel export (exceljs): Global KPIs, Monitoring Overview, optional detail
 * of selected FAs, and blocking lines. Written to data/exports/.
 */
import ExcelJS from "exceljs";
import type { FaLine } from "@facm/core";
import type { StoredSummary } from "../services/analyzer.js";
import { getAnalysisLines } from "../services/analyzer.js";

const STATUS_LABEL: Record<string, string> = {
  ready: "Ready for Closure",
  "waiting-forms": "Waiting Forms/GFE",
  "waiting-reconciliation": "Waiting Reconciliation",
  blocked: "Blocked",
  pending: "Pending",
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2430" },
};

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
}

export async function buildExcelExport(
  summaries: StoredSummary[],
  opts: { detailFaRefs?: string[]; title?: string },
  outPath: string
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FACM";
  wb.created = new Date();

  /* ---- Global KPIs ---- */
  const kpi = wb.addWorksheet("Global KPIs");
  kpi.columns = [{ width: 40 }, { width: 18 }];
  kpi.addRow([opts.title ?? "FACM — Global KPIs", ""]).font = { bold: true, size: 14 };
  kpi.addRow(["Generated", new Date().toISOString()]);
  kpi.addRow([]);
  const tot = (f: (s: StoredSummary) => number) => summaries.reduce((a, s) => a + f(s), 0);
  const rows: Array<[string, number]> = [
    ["Field Actions analyzed", summaries.length],
    ["Ready for Closure", summaries.filter((s) => s.closureStatus === "ready").length],
    ["Waiting Forms/GFE", summaries.filter((s) => s.closureStatus === "waiting-forms").length],
    ["Waiting Reconciliation", summaries.filter((s) => s.closureStatus === "waiting-reconciliation").length],
    ["Blocked / errors", summaries.filter((s) => s.closureStatus === "blocked").length],
    ["Expected responses", tot((s) => s.kpis.expectedResponses)],
    ["Forms received", tot((s) => s.kpis.formsReceived)],
    ["Closed by GFE", tot((s) => s.kpis.closedByGfe)],
    ["Open responses", tot((s) => s.kpis.openResponses)],
    ["Qty missing", tot((s) => s.kpis.qtyMissing)],
    ["RGA missing (non-blocking)", tot((s) => s.kpis.rgaMissingCount)],
  ];
  rows.forEach(([k, v]) => kpi.addRow([k, v]));

  /* ---- Monitoring Overview ---- */
  const STATUS_FILL: Record<string, string> = {
    ready: "FFE7F5EF", "waiting-forms": "FFFDEEE3",
    "waiting-reconciliation": "FFF8EFDD", blocked: "FFFCEAEA",
  };
  const ov = wb.addWorksheet("Monitoring Overview", { views: [{ state: "frozen", ySplit: 1 }] });
  ov.columns = [
    { header: "FA Ref", key: "faRef", width: 14 },
    { header: "Device", key: "device", width: 40 },
    { header: "File", key: "fileName", width: 45 },
    { header: "Type", key: "faType", width: 18 },
    { header: "Country", key: "country", width: 12 },
    { header: "Status", key: "status", width: 24 },
    { header: "Critical", key: "critical", width: 10 },
    { header: "Expected", key: "expected", width: 10 },
    { header: "Received", key: "received", width: 10 },
    { header: "GFE", key: "gfe", width: 8 },
    { header: "Open", key: "open", width: 8 },
    { header: "Completion", key: "completion", width: 12 },
    { header: "Qty to return", key: "qtyToReturn", width: 13 },
    { header: "Qty received", key: "qtyReceived", width: 13 },
    { header: "Qty missing", key: "qtyMissing", width: 12 },
    { header: "RGA missing", key: "rga", width: 12 },
  ];
  styleHeader(ov.getRow(1));
  for (const s of summaries) {
    const row = ov.addRow({
      faRef: s.faRef, device: s.deviceHint ?? "", fileName: s.fileName, faType: s.faType,
      country: s.country ?? "",
      status: STATUS_LABEL[s.closureStatus] ?? s.closureStatus, critical: s.critical ? "YES" : "",
      expected: s.kpis.expectedResponses, received: s.kpis.formsReceived, gfe: s.kpis.closedByGfe,
      open: s.kpis.openResponses,
      completion: s.kpis.completionRate !== null ? s.kpis.completionRate : "",
      qtyToReturn: s.kpis.qtyToReturn, qtyReceived: s.kpis.qtyReceived,
      qtyMissing: s.kpis.qtyMissing, rga: s.kpis.rgaMissingCount,
    });
    // ligne teintée selon le statut : lisible d'un coup d'œil hors app
    const fill = STATUS_FILL[s.closureStatus];
    if (fill) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
  }
  ov.getColumn("completion").numFmt = "0.0%";
  ov.autoFilter = { from: "A1", to: "P1" };

  /* ---- Blocking lines (open responses or qty missing) ---- */
  const bl = wb.addWorksheet("Blocking Lines");
  bl.columns = [
    { header: "FA Ref", width: 14 }, { header: "Sold To", width: 12 },
    { header: "Hospital", width: 40 }, { header: "City", width: 20 },
    { header: "Material", width: 16 }, { header: "Batch", width: 14 },
    { header: "Form", width: 8 }, { header: "Status", width: 12 },
    { header: "Qty to return", width: 13 }, { header: "Qty received", width: 13 },
    { header: "Qty missing", width: 12 }, { header: "RGA", width: 10 },
    { header: "Last notif", width: 12 },
  ] as Partial<ExcelJS.Column>[];
  styleHeader(bl.getRow(1));
  for (const s of summaries) {
    const lines = getAnalysisLines(s.analysisId) as FaLine[];
    for (const l of lines) {
      const blocking =
        l.formStatus === "open" || l.formStatus === "review" || l.qtyMissing > 0;
      if (!blocking) continue;
      bl.addRow([
        s.faRef, l.soldToRaw, l.hospitalName, l.city, l.materialNumber, l.batchNumber,
        l.form, l.formStatus, l.qtyToReturn ?? "", l.qtyReceivedEffective ?? "",
        l.qtyMissing, l.rga, l.notif3Date ?? l.notif2Date ?? "",
      ]);
    }
  }

  /* ---- Detail sheets for selected FAs ---- */
  for (const ref of opts.detailFaRefs ?? []) {
    const s = summaries.find((x) => x.faRef === ref);
    if (!s) continue;
    const ws = wb.addWorksheet(`FA ${ref}`.slice(0, 31));
    ws.columns = [
      { header: "Sold To", width: 12 }, { header: "Hospital", width: 40 },
      { header: "City", width: 18 }, { header: "Status", width: 12 },
      { header: "Lines", width: 8 }, { header: "Qty to return", width: 13 },
      { header: "Qty received", width: 13 }, { header: "Qty missing", width: 12 },
      { header: "RGA missing", width: 12 }, { header: "Last notif", width: 12 },
      { header: "Next action", width: 18 },
    ] as Partial<ExcelJS.Column>[];
    styleHeader(ws.getRow(1));
    for (const st of s.soldToSummaries) {
      ws.addRow([
        st.soldTo, st.hospitalName, st.city, st.formStatus, st.lineCount,
        st.qtyToReturn, st.qtyReceived, st.qtyMissing, st.rgaMissingCount,
        st.lastNotifDate ?? "", st.nextAction,
      ]);
    }
  }

  await wb.xlsx.writeFile(outPath);
}
