/**
 * Canonical domain types shared by the engine, the server and (as type-only
 * imports) the frontend. Every value must be JSON-safe: no NaN, no Infinity,
 * no Date objects — dates are ISO strings, absent numbers are null.
 */

/** Bumped whenever parsing/rules change, invalidates cached analyses. */
export const ENGINE_VERSION = "1.1.0";

export type FaType =
  | "recall"
  | "advisory"
  | "correction"
  | "recall-correction"
  | "unknown";

/** How responses are tracked for this file. */
export type TrackingMode = "vf" | "ack" | "none";

export type ClosureStatus =
  | "ready" // Ready for Closure
  | "waiting-forms" // Waiting Forms/GFE
  | "waiting-reconciliation" // Waiting Reconciliation
  | "blocked" // structural error / unknown type
  | "pending"; // not analyzed yet

export type FormStatus =
  | "received" // VF/Ackn. Form = 1
  | "gfe" // closed by GFE
  | "open" // no response yet
  | "excluded" // N/A line excluded from scope (corrections)
  | "review"; // unexpected value, needs human review

export type LineActionType =
  | "return-qty" // Return / Correction Qty
  | "scrap" // Scrap / Decommission
  | "no-qty" // No Qty Return / Correction
  | "review"; // Review Needed

export type DqSeverity = "info" | "warning" | "error";

export interface DqIssue {
  severity: DqSeverity;
  /** stable machine code, e.g. missing-column, suspicious-qty, filtered-rows */
  code: string;
  message: string;
  sheet?: string;
  detail?: string;
}

export interface FaLine {
  /** 1-based Excel row number in the source sheet */
  row: number;
  soldTo: string;
  soldToRaw: string;
  shipTo: string;
  hospitalName: string;
  city: string;
  country: string;
  materialNumber: string;
  batchNumber: string;
  materialDescription: string;
  qtySent: number | null;
  qtyToReturn: number | null;
  /** raw form value as text (VF or Ackn. Form depending on tracking mode) */
  form: string;
  formStatus: FormStatus;
  formDate: string | null;
  notif2Date: string | null;
  notif2Type: string;
  notif3Date: string | null;
  notif3Type: string;
  rga: string;
  qtyReceivedLocal: number | null;
  qtyReceivedDc: number | null;
  dateReceivedDc: string | null;
  /** max(qtyReceivedLocal, qtyReceivedDc) */
  qtyReceivedEffective: number | null;
  /** max(qtyToReturn - qtyReceivedEffective, 0) */
  qtyMissing: number;
  /** max(qtyReceivedEffective - qtyToReturn, 0) */
  extraQty: number;
  rgaMissing: boolean;
  actionType: LineActionType;
  notes: string;
}

export interface SoldToSummary {
  soldTo: string;
  hospitalName: string;
  city: string;
  country: string;
  lineCount: number;
  formStatus: FormStatus; // aggregated per Sold To
  qtyToReturn: number;
  qtyReceived: number;
  qtyMissing: number;
  extraQty: number;
  rgaMissingCount: number;
  lastNotifDate: string | null;
  /** suggested next action, i18n key */
  nextAction: string;
}

export interface FaKpis {
  expectedResponses: number;
  formsReceived: number;
  closedByGfe: number;
  openResponses: number;
  /** (formsReceived + closedByGfe) / expectedResponses, null when expected = 0 */
  completionRate: number | null;
  totalLines: number;
  excludedLines: number;
  reviewLines: number;
  qtyToReturn: number;
  qtyReceived: number;
  qtyMissing: number;
  extraQty: number;
  rgaMissingCount: number;
}

export interface AnalysisResult {
  engineVersion: string;
  fileName: string;
  /** FA reference extracted from filename, e.g. "97125289H" */
  faRef: string;
  country: string | null;
  faType: FaType;
  trackingMode: TrackingMode;
  /** dispositif concerné, dérivé de la Material Description dominante */
  deviceHint: string | null;
  sheetUsed: string | null;
  sheetNames: string[];
  headerRow: number | null;
  /** canonical key -> original Excel header */
  columnMapping: Record<string, string>;
  quality: DqIssue[];
  kpis: FaKpis;
  closureStatus: ClosureStatus;
  /** true when open responses remain past the notification deadline */
  critical: boolean;
  soldToSummaries: SoldToSummary[];
  lines: FaLine[];
  analyzedAt: string;
  /** non-fatal error message when the file could not be analyzed */
  error: string | null;
}

export interface AnalyzeOptions {
  /** days after the last notification before an open response is critical */
  deadlineDays?: number;
  /** cap on data rows read per sheet (safety valve, 0 = unlimited) */
  maxRows?: number;
}
