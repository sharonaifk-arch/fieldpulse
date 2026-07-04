/**
 * Business rules shared by every FA type (Recall, Advisory, Correction,
 * hybrid). The tracking column differs (VF vs Ackn. Form) and corrections
 * exclude N/A lines, but the closure logic is common:
 *
 *  Forms Received   = Sold To with at least one line form=1
 *  Closed by GFE    = Sold To without form=1 but with form=GFE
 *  Open Responses   = Sold To with neither
 *  Completion rate  = (received + gfe) / expected
 *  Qty Missing      = max(qtyToReturn - max(qtyLocal, qtyDC), 0)   (VF mode)
 *  Closure          = Waiting Forms/GFE -> Waiting Reconciliation -> Ready
 *
 * KEY NON-OBVIOUS RULE — form="N/A":
 *  Correction & Recall/Correction files mark out-of-scope lines with the
 *  literal string "N/A" in VF; those lines are EXCLUDED from all counts
 *  (tracked in kpis.excludedLines). For pure Recall/Advisory, N/A is not
 *  expected and becomes "review".
 */
import type {
  AnalysisResult, AnalyzeOptions, ClosureStatus, DqIssue, FaKpis, FaLine,
  FaType, FormStatus, LineActionType, SoldToSummary, TrackingMode,
} from "../types.js";
import {
  asText, isBlank, jsonSafe, normalizeSoldTo, parseDate, parseFormValue,
  parseQty, round4,
} from "../excel/valueParsers.js";
import type { HeaderDetection } from "../excel/headerDetector.js";

const SCRAP_PATTERN = /scrap|decommission|destro|discard/i;

interface BuildContext {
  faType: FaType;
  trackingMode: TrackingMode;
  quality: DqIssue[];
  sheetName: string;
}

/** N/A in the form column means "out of scope" only for correction-flavored FAs. */
function naIsExcluded(faType: FaType): boolean {
  return faType === "correction" || faType === "recall-correction";
}

function cell(row: unknown[], idx: number | undefined): unknown {
  return idx === undefined ? null : row[idx];
}

export function buildLines(
  rows: unknown[][],
  header: HeaderDetection,
  ctx: BuildContext
): { lines: FaLine[]; filteredRows: number } {
  const ix = header.indexByKey;
  const formIdx = ctx.trackingMode === "ack" ? ix["acknForm"] : ix["vf"];
  const lines: FaLine[] = [];
  let filteredRows = 0;
  let suspiciousReported = 0;

  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const soldToRaw = asText(cell(row, ix["soldTo"]));
    // rows without Sold To are totals/blank separators -> filtered out
    if (soldToRaw === "") {
      if (row.some((c) => !isBlank(c))) filteredRows++;
      continue;
    }

    const qtySent = parseQty(cell(row, ix["qtySent"]));
    const qtyToReturn = parseQty(cell(row, ix["qtyToReturn"]));
    const qtyLocal = parseQty(cell(row, ix["qtyReceivedLocal"]));
    const qtyDc = parseQty(cell(row, ix["qtyReceivedDc"]));

    for (const q of [qtySent, qtyToReturn, qtyLocal, qtyDc]) {
      if (q.suspicious && !SCRAP_PATTERN.test(q.suspicious) && suspiciousReported < 20) {
        ctx.quality.push({
          severity: "warning",
          code: "suspicious-qty",
          message: `Valeur non numérique dans une colonne quantité (ligne ${r + 1})`,
          sheet: ctx.sheetName,
          detail: q.suspicious,
        });
        suspiciousReported++;
      }
    }

    const formRaw = cell(row, formIdx);
    const fv = parseFormValue(formRaw);
    let formStatus: FormStatus;
    if (fv === "na") formStatus = naIsExcluded(ctx.faType) ? "excluded" : "review";
    else formStatus = fv;

    const received = Math.max(qtyLocal.value ?? 0, qtyDc.value ?? 0);
    const hasReceived = qtyLocal.value !== null || qtyDc.value !== null;
    const toReturn = qtyToReturn.value ?? 0;
    const qtyMissing = Math.max(toReturn - received, 0);
    const extraQty = Math.max(received - toReturn, 0);

    const notes = asText(cell(row, ix["notes"]));
    const scrapHinted =
      SCRAP_PATTERN.test(notes) ||
      [qtyToReturn, qtyLocal, qtyDc].some((q) => q.suspicious !== null && SCRAP_PATTERN.test(q.suspicious));

    let actionType: LineActionType;
    if (formStatus === "excluded") actionType = "no-qty";
    else if (scrapHinted) actionType = "scrap";
    else if (qtyToReturn.suspicious) actionType = "review";
    else if (toReturn > 0) actionType = "return-qty";
    else actionType = "no-qty";

    const rga = asText(cell(row, ix["rga"]));
    const rgaMissing =
      ctx.trackingMode === "vf" && formStatus !== "excluded" && toReturn > 0 && (rga === "" || isBlank(rga));

    lines.push({
      row: r + 1,
      soldTo: normalizeSoldTo(soldToRaw),
      soldToRaw,
      shipTo: asText(cell(row, ix["shipTo"])),
      hospitalName: asText(cell(row, ix["hospitalName"])),
      city: asText(cell(row, ix["city"])),
      country: asText(cell(row, ix["country"])),
      materialNumber: asText(cell(row, ix["materialNumber"])),
      batchNumber: asText(cell(row, ix["batchNumber"])),
      materialDescription: asText(cell(row, ix["materialDescription"])),
      qtySent: jsonSafe(qtySent.value),
      qtyToReturn: jsonSafe(qtyToReturn.value),
      form: asText(formRaw),
      formStatus,
      formDate: parseDate(cell(row, ix["formDate"])),
      notif2Date: parseDate(cell(row, ix["notif2Date"])),
      notif2Type: asText(cell(row, ix["notif2Type"])),
      notif3Date: parseDate(cell(row, ix["notif3Date"])),
      notif3Type: asText(cell(row, ix["notif3Type"])),
      rga,
      qtyReceivedLocal: jsonSafe(qtyLocal.value),
      qtyReceivedDc: jsonSafe(qtyDc.value),
      dateReceivedDc: parseDate(cell(row, ix["dateReceivedDc"])),
      qtyReceivedEffective: hasReceived ? jsonSafe(received) : null,
      qtyMissing: formStatus === "excluded" ? 0 : qtyMissing,
      extraQty: formStatus === "excluded" ? 0 : extraQty,
      rgaMissing,
      actionType,
      notes,
    });
  }

  if (filteredRows > 0) {
    ctx.quality.push({
      severity: "info",
      code: "filtered-rows",
      message: `${filteredRows} ligne(s) sans Sold To ignorée(s) (totaux, commentaires)`,
      sheet: ctx.sheetName,
    });
  }

  return { lines, filteredRows };
}

/** Aggregated form status per Sold To: received > gfe > open (review wins over open). */
function aggregateFormStatus(statuses: FormStatus[]): FormStatus {
  const active = statuses.filter((s) => s !== "excluded");
  if (active.length === 0) return "excluded";
  if (active.includes("received")) return "received";
  if (active.includes("gfe")) return "gfe";
  if (active.includes("review")) return "review";
  return "open";
}

function nextActionFor(status: FormStatus, qtyMissing: number, notif2: string | null, notif3: string | null): string {
  if (status === "open" || status === "review") {
    if (!notif2) return "send-notif-2";
    if (!notif3) return "send-notif-3";
    return "escalate-gfe";
  }
  if (qtyMissing > 0) return "chase-return";
  return "none";
}

export function buildSoldToSummaries(lines: FaLine[]): SoldToSummary[] {
  const byKey = new Map<string, FaLine[]>();
  for (const l of lines) {
    const arr = byKey.get(l.soldTo) ?? [];
    arr.push(l);
    byKey.set(l.soldTo, arr);
  }
  const out: SoldToSummary[] = [];
  for (const [soldTo, group] of byKey) {
    const status = aggregateFormStatus(group.map((l) => l.formStatus));
    const active = group.filter((l) => l.formStatus !== "excluded");
    const qtyToReturn = active.reduce((s, l) => s + (l.qtyToReturn ?? 0), 0);
    const qtyReceived = active.reduce((s, l) => s + (l.qtyReceivedEffective ?? 0), 0);
    const qtyMissing = active.reduce((s, l) => s + l.qtyMissing, 0);
    const extraQty = active.reduce((s, l) => s + l.extraQty, 0);
    const dates = active.flatMap((l) => [l.notif2Date, l.notif3Date]).filter((d): d is string => !!d);
    const lastNotifDate = dates.length ? dates.sort().at(-1)! : null;
    const notif2 = active.find((l) => l.notif2Date)?.notif2Date ?? null;
    const notif3 = active.find((l) => l.notif3Date)?.notif3Date ?? null;
    out.push({
      soldTo,
      hospitalName: group[0].hospitalName,
      city: group[0].city,
      country: group[0].country,
      lineCount: group.length,
      formStatus: status,
      qtyToReturn,
      qtyReceived,
      qtyMissing,
      extraQty,
      rgaMissingCount: active.filter((l) => l.rgaMissing).length,
      lastNotifDate,
      nextAction: status === "excluded" ? "none" : nextActionFor(status, qtyMissing, notif2, notif3),
    });
  }
  return out;
}

export function computeKpis(lines: FaLine[], summaries: SoldToSummary[]): FaKpis {
  const scoped = summaries.filter((s) => s.formStatus !== "excluded");
  const formsReceived = scoped.filter((s) => s.formStatus === "received").length;
  const closedByGfe = scoped.filter((s) => s.formStatus === "gfe").length;
  const openResponses = scoped.filter((s) => s.formStatus === "open" || s.formStatus === "review").length;
  const expected = scoped.length;
  return {
    expectedResponses: expected,
    formsReceived,
    closedByGfe,
    openResponses,
    completionRate: expected > 0 ? round4((formsReceived + closedByGfe) / expected) : null,
    totalLines: lines.length,
    excludedLines: lines.filter((l) => l.formStatus === "excluded").length,
    reviewLines: lines.filter((l) => l.formStatus === "review").length,
    qtyToReturn: scoped.reduce((s, x) => s + x.qtyToReturn, 0),
    qtyReceived: scoped.reduce((s, x) => s + x.qtyReceived, 0),
    qtyMissing: scoped.reduce((s, x) => s + x.qtyMissing, 0),
    extraQty: scoped.reduce((s, x) => s + x.extraQty, 0),
    rgaMissingCount: lines.filter((l) => l.rgaMissing).length,
  };
}

export function computeClosureStatus(kpis: FaKpis, trackingMode: TrackingMode): ClosureStatus {
  if (trackingMode === "none") return "blocked";
  if (kpis.openResponses > 0) return "waiting-forms";
  // reconciliation only applies to VF-tracked FAs (advisories have no product return)
  if (trackingMode === "vf" && kpis.qtyMissing > 0) return "waiting-reconciliation";
  return "ready";
}

/** An FA is critical when open responses linger past deadlineDays after the last notification. */
export function computeCritical(
  summaries: SoldToSummary[],
  opts: AnalyzeOptions | undefined,
  now: Date = new Date()
): boolean {
  const deadlineDays = opts?.deadlineDays ?? 30;
  const cutoff = new Date(now.getTime() - deadlineDays * 86400 * 1000).toISOString().slice(0, 10);
  return summaries.some(
    (s) => (s.formStatus === "open" || s.formStatus === "review") && s.lastNotifDate !== null && s.lastNotifDate < cutoff
  );
}

export type { AnalysisResult };
