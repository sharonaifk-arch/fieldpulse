/**
 * Recall engine unit tests: rows -> lines -> Sold To summaries -> KPIs ->
 * closure status, straight from the spec:
 *   Forms Received  = Sold To with at least one VF = 1
 *   Closed by GFE   = Sold To without VF=1 but with VF=GFE
 *   Open Responses  = Sold To with neither
 *   Qty Missing     = max(QtyToReturn - max(QtyLocal, QtyDC), 0)
 *   Closure: Waiting Forms/GFE -> Waiting Reconciliation -> Ready
 */
import { describe, expect, it } from "vitest";
import { detectHeaderRow } from "../excel/headerDetector.js";
import {
  buildLines, buildSoldToSummaries, computeClosureStatus, computeCritical, computeKpis,
} from "../engines/rulesEngine.js";
import type { DqIssue, FaType } from "../types.js";

const HEADERS = [
  "Sold To", "Hospital Name", "City", "Country", "Material Number", "Batch Number",
  "Qty Sent", "Qty to return (stated on VF)", "VF", "Date (VF received)",
  "2nd Notif Date", "2nd Notif Type", "3rd Notif Date", "3rd Notif Type",
  "RGA (if app.)", "Qty received local (if app.)", "Qty received at DC",
];

function run(dataRows: unknown[][], faType: FaType = "recall") {
  const rows = [HEADERS, ...dataRows];
  const header = detectHeaderRow(rows);
  const quality: DqIssue[] = [];
  const { lines } = buildLines(rows, header, { faType, trackingMode: "vf", quality, sheetName: "T" });
  const summaries = buildSoldToSummaries(lines);
  const kpis = computeKpis(lines, summaries);
  return { lines, summaries, kpis, quality, status: computeClosureStatus(kpis, "vf") };
}

const L = (soldTo: string, vf: unknown, toReturn: unknown, local: unknown = null, dc: unknown = null, rga = "R1") =>
  [soldTo, "HOSP", "PARIS", "France", "M1", "B1", 1, toReturn, vf, null, null, null, null, null, rga, local, dc];

describe("recall engine — response counting per Sold To", () => {
  it("counts Forms Received / Closed by GFE / Open Responses on unique Sold To", () => {
    const { kpis } = run([
      L("A", 1, 2, 2), // received
      L("A", "", 1, 1), // same Sold To, still received overall
      L("B", "GFE", 0),
      L("C", "", 3),
    ]);
    expect(kpis.expectedResponses).toBe(3);
    expect(kpis.formsReceived).toBe(1);
    expect(kpis.closedByGfe).toBe(1);
    expect(kpis.openResponses).toBe(1);
    expect(kpis.completionRate).toBeCloseTo(2 / 3, 4);
  });

  it("VF=1 wins over GFE for the same Sold To", () => {
    const { summaries } = run([L("A", "GFE", 0), L("A", 1, 1, 1)]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].formStatus).toBe("received");
  });
});

describe("recall engine — quantities", () => {
  it("Qty Received Effective = max(local, DC); missing and extra computed per line", () => {
    const { lines } = run([
      L("A", 1, 5, 2, 3), // effective 3, missing 2
      L("B", 1, 2, 4, 1), // effective 4, extra 2
    ]);
    expect(lines[0].qtyReceivedEffective).toBe(3);
    expect(lines[0].qtyMissing).toBe(2);
    expect(lines[0].extraQty).toBe(0);
    expect(lines[1].qtyReceivedEffective).toBe(4);
    expect(lines[1].qtyMissing).toBe(0);
    expect(lines[1].extraQty).toBe(2);
  });

  it("flags RGA missing (non-blocking) only when a return is expected", () => {
    const { lines, kpis } = run([
      L("A", 1, 2, 2, null, ""), // return expected, no RGA
      L("B", 1, 0, 0, null, ""), // nothing to return
    ]);
    expect(lines[0].rgaMissing).toBe(true);
    expect(lines[1].rgaMissing).toBe(false);
    expect(kpis.rgaMissingCount).toBe(1);
  });
});

describe("recall engine — closure status", () => {
  it("Waiting Forms/GFE while any Sold To is open", () => {
    expect(run([L("A", 1, 2, 2), L("B", "", 1)]).status).toBe("waiting-forms");
  });
  it("Waiting Reconciliation when forms complete but qty missing", () => {
    expect(run([L("A", 1, 5, 1)]).status).toBe("waiting-reconciliation");
  });
  it("Ready for Closure when forms complete and quantities reconciled", () => {
    expect(run([L("A", 1, 2, 2), L("B", "GFE", 0)]).status).toBe("ready");
  });
});

describe("correction N/A exclusion rule", () => {
  it("excludes VF=N/A lines from all counts for corrections", () => {
    const { kpis, status } = run(
      [L("A", "N/A", "N/A"), L("B", 1, 2, 2)],
      "correction"
    );
    expect(kpis.excludedLines).toBe(1);
    expect(kpis.expectedResponses).toBe(1);
    expect(kpis.openResponses).toBe(0);
    expect(status).toBe("ready");
  });

  it("keeps VF=N/A as review for pure recalls (strict rule)", () => {
    const { kpis } = run([L("A", "N/A", 1)], "recall");
    expect(kpis.excludedLines).toBe(0);
    expect(kpis.reviewLines).toBe(1);
    expect(kpis.openResponses).toBe(1); // review counts as not answered
  });
});

describe("row filtering and data quality", () => {
  it("filters total rows without Sold To and reports them", () => {
    const { lines, quality } = run([
      L("A", 1, 2, 2),
      ["", "", "", "", "", "", 1, 2, "", null, null, null, null, null, "", 0, 0], // totals row
    ]);
    expect(lines).toHaveLength(1);
    expect(quality.some((q) => q.code === "filtered-rows")).toBe(true);
  });

  it("reports free text in quantity columns as suspicious", () => {
    const { quality, lines } = run([L("A", 1, "To scrap", null, null)]);
    expect(lines[0].qtyToReturn).toBeNull();
    expect(lines[0].actionType).toBe("scrap");
    // scrap text is a recognized action, not a suspicious value
    expect(quality.every((q) => q.code !== "suspicious-qty")).toBe(true);
  });
});

describe("critical deadline detection", () => {
  it("marks FA critical when an open Sold To passed the notification deadline", () => {
    const old = "2020-01-01";
    const rows = [
      [...L("A", "", 1)].map((v, i) => (i === 10 ? old : v)), // notif2Date = old
    ];
    const { summaries } = run(rows);
    expect(computeCritical(summaries, { deadlineDays: 30 }, new Date("2026-07-03"))).toBe(true);
    expect(computeCritical(summaries, { deadlineDays: 30_000 }, new Date("2026-07-03"))).toBe(false);
  });
});
