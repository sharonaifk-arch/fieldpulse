/**
 * Two-pass Excel reading (SheetJS), tuned for real BSC files where reference
 * sheets can exceed 80 000 rows:
 *   pass 1 — sheet names only (bookSheets)
 *   pass 2 — 15-row preview of each sheet, scored to find the main sheet
 *   pass 3 — full read of the chosen sheet only, as array-of-arrays
 * The source file is opened read-only and never modified.
 */
import * as XLSX from "xlsx";
import { scoreSheet, pickMainSheet, type SheetCandidate } from "./sheetDetector.js";

export interface WorkbookScan {
  sheetNames: string[];
  candidates: SheetCandidate[];
  main: SheetCandidate | null;
  /** full AOA rows of the main sheet (raw values, no formatting) */
  rows: unknown[][];
}

const PREVIEW_ROWS = 15;

function sheetToAoa(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
}

export function readWorkbookFromBuffer(buf: Buffer | Uint8Array, opts?: { maxRows?: number }): WorkbookScan {
  const names = XLSX.read(buf, { type: "buffer", bookSheets: true }).SheetNames ?? [];

  const candidates: SheetCandidate[] = [];
  for (const name of names) {
    const wb = XLSX.read(buf, { type: "buffer", sheets: [name], sheetRows: PREVIEW_ROWS });
    const ws = wb.Sheets[name];
    const preview = ws ? sheetToAoa(ws) : [];
    candidates.push(scoreSheet(name, preview));
  }

  const main = pickMainSheet(candidates);
  let rows: unknown[][] = [];
  if (main) {
    const maxRows = opts?.maxRows && opts.maxRows > 0 ? opts.maxRows : 0;
    const wb = XLSX.read(buf, {
      type: "buffer",
      sheets: [main.name],
      ...(maxRows ? { sheetRows: maxRows } : {}),
    });
    const ws = wb.Sheets[main.name];
    rows = ws ? sheetToAoa(ws) : [];
  }

  return { sheetNames: names, candidates, main, rows };
}
