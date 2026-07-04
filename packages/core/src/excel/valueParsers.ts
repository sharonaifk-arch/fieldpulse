/**
 * Cell value parsers. Real BSC files contain: numbers stored as text,
 * "N/A" / "N/I" / "NI" placeholders, free text in quantity columns
 * ("To scrap"), Excel serial dates, and strings in at least four date
 * formats ("3/25/26", "25-Mar-26", "24-FEB-2026", "03/11/2016").
 * Everything returned here is JSON-safe.
 */

export const NA_VALUES = new Set(["n/a", "na", "n/i", "ni", "-", "--"]);

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

export function isNaValue(v: unknown): boolean {
  return NA_VALUES.has(String(v ?? "").trim().toLowerCase());
}

export function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export interface QtyParse {
  value: number | null;
  /** original text kept when it was not a clean number (e.g. "To scrap") */
  suspicious: string | null;
}

/** Parses a quantity cell. Blank / N/A -> null. Free text -> suspicious. */
export function parseQty(v: unknown): QtyParse {
  if (isBlank(v) || isNaValue(v)) return { value: null, suspicious: null };
  if (typeof v === "number" && Number.isFinite(v)) return { value: v, suspicious: null };
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return { value: n, suspicious: null };
  return { value: null, suspicious: String(v).trim() };
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function toIso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Excel serial date (1900 system) -> ISO yyyy-mm-dd. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > 80000) return null; // 61 = 1900-03-01, avoids the leap-year bug zone
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

/**
 * Parses a date cell to ISO yyyy-mm-dd, or null.
 * String formats, in order: "25-Mar-26" / "24-FEB-2026", "dd/mm/yyyy"
 * (EU files — day first), "m/d/yy" US fallback when day-first is invalid.
 */
export function parseDate(v: unknown): string | null {
  if (isBlank(v) || isNaValue(v)) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return excelSerialToIso(v);

  const s = String(v).trim();

  // 25-Mar-26 | 24-FEB-2026 | 3 Nov 16
  let m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      let y = Number(m[3]);
      if (y < 100) y += y < 70 ? 2000 : 1900;
      return toIso(y, month, Number(m[1]));
    }
  }

  // dd/mm/yyyy or d/m/yy — EU day-first, US fallback
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const dayFirst = toIso(y, b - 1, a);
    if (b <= 12 && dayFirst) return dayFirst;
    return toIso(y, a - 1, b); // month-first fallback (e.g. "3/25/26")
  }

  // ISO yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return toIso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  return null;
}

/**
 * Sold To normalization: strips leading zeros so "0000060096" and "60096"
 * group together, keeps the raw value for display.
 */
export function normalizeSoldTo(v: unknown): string {
  const s = asText(v);
  const stripped = s.replace(/^0+(?=\d)/, "");
  return stripped;
}

export type FormValue = "received" | "gfe" | "open" | "na" | "review";

/**
 * Interprets a VF / Ackn. Form cell:
 *  1 (or "1") -> received; "GFE" -> gfe; blank -> open; N/A -> na;
 *  anything else -> review.
 */
export function parseFormValue(v: unknown): FormValue {
  if (isBlank(v)) return "open";
  if (isNaValue(v)) return "na";
  const s = String(v).trim().toLowerCase();
  if (s === "1" || v === 1) return "received";
  if (s === "gfe") return "gfe";
  return "review";
}

/** Ensures a number is JSON-safe (finite) — otherwise null. */
export function jsonSafe(n: number | null): number | null {
  return n !== null && Number.isFinite(n) ? n : null;
}

/** Rounds to 4 decimals to avoid float noise in rates. */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
