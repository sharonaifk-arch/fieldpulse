/**
 * Sheet detection: picks the main tracking sheet of a workbook.
 *
 * Real files contain reference sheets that must be skipped: "Latitude Master"
 * (80 000+ rows), "SAP PO Date", DHL shipping snapshots, etc. Strategy:
 * score every sheet from a cheap 15-row preview (header detection + weights),
 * penalize known reference names, then prefer VF sheets over Ackn. Form (MM)
 * sheets — VF is the authoritative tracking for Recall/Correction.
 */
import type { HeaderDetection } from "./headerDetector.js";
import { detectHeaderRow } from "./headerDetector.js";

export interface SheetCandidate {
  name: string;
  header: HeaderDetection;
  score: number;
  kind: "vf" | "ack" | "other";
}

const REFERENCE_NAME_PATTERNS = [
  /latitude/i,
  /sap\s*po/i,
  /dec\s*list/i,
  /master/i,
  /dhl/i,
  /esker/i,
  /snapshot/i,
  /archive/i,
];

export function scoreSheet(name: string, previewRows: unknown[][]): SheetCandidate {
  const header = detectHeaderRow(previewRows);
  let score = header.score;
  const isReference = REFERENCE_NAME_PATTERNS.some((p) => p.test(name));
  if (isReference) score -= 10;

  let kind: SheetCandidate["kind"] = "other";
  if ("vf" in header.indexByKey) kind = "vf";
  else if ("acknForm" in header.indexByKey) kind = "ack";
  if (kind === "vf") score += 6;
  else if (kind === "ack") score += 3;

  return { name, header, score, kind };
}

/**
 * Picks the best candidate: highest score wins; VF beats Ackn. Form on ties.
 * Returns null when no sheet reaches a usable score.
 */
export function pickMainSheet(candidates: SheetCandidate[]): SheetCandidate | null {
  const usable = candidates.filter((c) => c.header.rowIndex >= 0 && c.score > 0);
  if (usable.length === 0) return null;
  const rank = { vf: 2, ack: 1, other: 0 };
  usable.sort((a, b) => b.score - a.score || rank[b.kind] - rank[a.kind]);
  return usable[0];
}
