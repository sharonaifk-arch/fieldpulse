/**
 * Orchestrator: buffer -> workbook scan -> type detection -> rules engine
 * -> AnalysisResult. Never throws for data problems: structural issues are
 * reported through `quality` and `error`, so one bad file can't break a
 * batch run.
 */
import type { AnalysisResult, AnalyzeOptions, DqIssue } from "../types.js";
import { ENGINE_VERSION } from "../types.js";
import { readWorkbookFromBuffer } from "../excel/workbookReader.js";
import { detectFaType, extractCountry, extractFaRef } from "./typeDetector.js";
import {
  buildLines, buildSoldToSummaries, computeClosureStatus, computeCritical, computeKpis,
} from "./rulesEngine.js";

const EMPTY_KPIS = {
  expectedResponses: 0, formsReceived: 0, closedByGfe: 0, openResponses: 0,
  completionRate: null, totalLines: 0, excludedLines: 0, reviewLines: 0,
  qtyToReturn: 0, qtyReceived: 0, qtyMissing: 0, extraQty: 0, rgaMissingCount: 0,
};

export function analyzeWorkbook(
  buf: Buffer | Uint8Array,
  fileName: string,
  options?: AnalyzeOptions
): AnalysisResult {
  const quality: DqIssue[] = [];
  const base: AnalysisResult = {
    engineVersion: ENGINE_VERSION,
    fileName,
    faRef: extractFaRef(fileName),
    country: extractCountry(fileName),
    faType: "unknown",
    trackingMode: "none",
    deviceHint: null,
    sheetUsed: null,
    sheetNames: [],
    headerRow: null,
    columnMapping: {},
    quality,
    kpis: { ...EMPTY_KPIS },
    closureStatus: "blocked",
    critical: false,
    soldToSummaries: [],
    lines: [],
    analyzedAt: new Date().toISOString(),
    error: null,
  };

  let scan;
  try {
    scan = readWorkbookFromBuffer(buf, { maxRows: options?.maxRows });
  } catch (e) {
    base.error = `Fichier illisible: ${e instanceof Error ? e.message : String(e)}`;
    quality.push({ severity: "error", code: "unreadable-file", message: base.error });
    return base;
  }

  base.sheetNames = scan.sheetNames;
  if (!scan.main) {
    base.faType = "unknown";
    base.error = "Aucune feuille de suivi reconnue (ni VF ni Ackn. Form)";
    quality.push({
      severity: "error",
      code: "no-tracking-sheet",
      message: base.error,
      detail: scan.sheetNames.join(", "),
    });
    return base;
  }

  const { faType, trackingMode } = detectFaType(scan.main, fileName);
  base.faType = faType;
  base.trackingMode = trackingMode;
  base.sheetUsed = scan.main.name;
  base.headerRow = scan.main.header.rowIndex + 1;
  base.columnMapping = { ...scan.main.header.originalByKey };

  quality.push({
    severity: "info",
    code: "column-mapping",
    message: `${Object.keys(base.columnMapping).length} colonnes reconnues sur la feuille "${scan.main.name}" (en-tête ligne ${base.headerRow})`,
    sheet: scan.main.name,
  });

  // required columns per tracking mode
  const required =
    trackingMode === "vf" ? ["soldTo", "vf"] : trackingMode === "ack" ? ["soldTo", "acknForm"] : ["soldTo"];
  for (const key of required) {
    if (!(key in scan.main.header.indexByKey)) {
      quality.push({
        severity: "error",
        code: "missing-column",
        message: `Colonne obligatoire absente: ${key}`,
        sheet: scan.main.name,
      });
    }
  }
  if (trackingMode === "vf" && !("qtyToReturn" in scan.main.header.indexByKey)) {
    quality.push({
      severity: "warning",
      code: "missing-column",
      message: "Colonne 'Qty to return' absente — réconciliation quantités impossible",
      sheet: scan.main.name,
    });
  }

  const { lines } = buildLines(scan.rows, scan.main.header, {
    faType, trackingMode, quality, sheetName: scan.main.name,
  });
  const summaries = buildSoldToSummaries(lines);
  const kpis = computeKpis(lines, summaries);

  base.lines = lines;
  base.soldToSummaries = summaries;
  base.kpis = kpis;
  base.closureStatus = computeClosureStatus(kpis, trackingMode);
  base.critical = computeCritical(summaries, options);

  if (!base.country && lines.length > 0 && lines[0].country) base.country = lines[0].country;

  // dispositif concerné : Material Description la plus fréquente (repli : Material Number)
  const freq = new Map<string, number>();
  for (const l of lines) {
    const key = l.materialDescription || "";
    if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  if (freq.size === 0) {
    for (const l of lines) {
      const key = l.materialNumber || "";
      if (key && !/^no part/i.test(key)) freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  base.deviceHint = top ? `${top[0].slice(0, 60)}${freq.size > 1 ? ` +${freq.size - 1}` : ""}` : null;
  if (faType === "unknown") {
    quality.push({
      severity: "warning",
      code: "unknown-type",
      message: "Type de Field Action non déterminé — vérifiez le nom du fichier et les colonnes",
    });
  }

  return base;
}
