/**
 * Diff between two analysis runs: which FAs appeared/disappeared, whose
 * closure status changed, and how the headline KPIs moved.
 */
import { getRunResults, type StoredSummary } from "./analyzer.js";

export interface FaDiff {
  faRef: string;
  fileName: string;
  kind: "added" | "removed" | "status-changed" | "kpi-changed" | "unchanged";
  before: { closureStatus: string; openResponses: number; qtyMissing: number } | null;
  after: { closureStatus: string; openResponses: number; qtyMissing: number } | null;
}

const snap = (s: StoredSummary) => ({
  closureStatus: s.closureStatus,
  openResponses: s.kpis.openResponses,
  qtyMissing: s.kpis.qtyMissing,
});

export function diffRuns(runA: number, runB: number): FaDiff[] {
  const before = new Map(getRunResults(runA).map((s) => [s.faRef, s]));
  const after = new Map(getRunResults(runB).map((s) => [s.faRef, s]));
  const refs = new Set([...before.keys(), ...after.keys()]);
  const out: FaDiff[] = [];
  for (const ref of refs) {
    const a = before.get(ref);
    const b = after.get(ref);
    if (a && !b) out.push({ faRef: ref, fileName: a.fileName, kind: "removed", before: snap(a), after: null });
    else if (!a && b) out.push({ faRef: ref, fileName: b.fileName, kind: "added", before: null, after: snap(b) });
    else if (a && b) {
      const sa = snap(a), sb = snap(b);
      const kind =
        sa.closureStatus !== sb.closureStatus
          ? "status-changed"
          : sa.openResponses !== sb.openResponses || sa.qtyMissing !== sb.qtyMissing
            ? "kpi-changed"
            : "unchanged";
      out.push({ faRef: ref, fileName: b.fileName, kind, before: sa, after: sb });
    }
  }
  const order = { "status-changed": 0, "kpi-changed": 1, added: 2, removed: 3, unchanged: 4 };
  out.sort((x, y) => order[x.kind] - order[y.kind] || x.faRef.localeCompare(y.faRef));
  return out;
}
