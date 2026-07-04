/**
 * Score-based header row detection. BSC main FA sheets have a merged
 * "meta-group" row 1 (FA | GFE RVTF | Reconciliation Country | ...) with the
 * real headers on row 2; MM sheets have headers directly on row 1. We score
 * the first N rows against the alias dictionary and pick the best one.
 */
import { mapHeaderRow, SCORE_WEIGHTS } from "./columnAliases.js";

export interface HeaderDetection {
  /** 0-based index of the header row in the AOA, or -1 */
  rowIndex: number;
  score: number;
  indexByKey: Record<string, number>;
  originalByKey: Record<string, string>;
}

const MAX_HEADER_SEARCH_ROWS = 15;
const MIN_SCORE = 8; // requires at least soldTo + one strong tracking column

export function detectHeaderRow(rows: unknown[][]): HeaderDetection {
  let best: HeaderDetection = { rowIndex: -1, score: 0, indexByKey: {}, originalByKey: {} };
  const limit = Math.min(rows.length, MAX_HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const { indexByKey, originalByKey } = mapHeaderRow(rows[i] ?? []);
    let score = 0;
    for (const key of Object.keys(indexByKey)) score += SCORE_WEIGHTS[key] ?? 1;
    // header must at least identify customers
    if (!("soldTo" in indexByKey)) score = Math.min(score, 3);
    if (score > best.score) best = { rowIndex: i, score, indexByKey, originalByKey };
  }
  if (best.score < MIN_SCORE) return { rowIndex: -1, score: best.score, indexByKey: {}, originalByKey: {} };
  return best;
}
