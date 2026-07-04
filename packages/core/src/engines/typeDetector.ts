/**
 * Field Action type detection, combining the chosen sheet's columns with
 * filename hints:
 *  - VF sheet + "qty to return / correct" wording  -> recall-correction hybrid
 *  - VF sheet + "qty to return (stated on VF)"     -> recall
 *  - Ackn. Form sheet only + "correction" filename -> correction (MM tracking)
 *  - Ackn. Form sheet only                          -> advisory
 *  - nothing usable                                 -> unknown
 */
import type { FaType, TrackingMode } from "../types.js";
import { normalizeHeader } from "../excel/columnAliases.js";
import type { SheetCandidate } from "../excel/sheetDetector.js";

export interface TypeDetection {
  faType: FaType;
  trackingMode: TrackingMode;
}

export function detectFaType(main: SheetCandidate | null, fileName: string): TypeDetection {
  const nameHintsCorrection = /correction/i.test(fileName);
  const nameHintsAdvisory = /advisory/i.test(fileName);
  const nameHintsRecall = /recall/i.test(fileName);

  if (!main) return { faType: "unknown", trackingMode: "none" };

  if (main.kind === "vf") {
    const qtyHeader = normalizeHeader(main.header.originalByKey["qtyToReturn"] ?? "");
    const mentionsCorrect = /correct/.test(qtyHeader);
    if (mentionsCorrect && nameHintsCorrection) return { faType: "correction", trackingMode: "vf" };
    if (mentionsCorrect) return { faType: "recall-correction", trackingMode: "vf" };
    if (nameHintsCorrection) return { faType: "correction", trackingMode: "vf" };
    return { faType: "recall", trackingMode: "vf" };
  }

  if (main.kind === "ack") {
    if (nameHintsCorrection) return { faType: "correction", trackingMode: "ack" };
    if (nameHintsRecall) return { faType: "recall", trackingMode: "ack" };
    // MM/Ackn tracking without other hints = advisory
    void nameHintsAdvisory;
    return { faType: "advisory", trackingMode: "ack" };
  }

  return { faType: "unknown", trackingMode: "none" };
}

/** Extracts the FA reference from a filename, e.g. "97125289H_-_Cust_list..." */
export function extractFaRef(fileName: string): string {
  const m = fileName.match(/(\d{6,9}[A-Z]?)/);
  return m ? m[1] : fileName.replace(/\.[^.]+$/, "");
}

/** Extracts a country hint from the filename (France, Belgium, ...). */
export function extractCountry(fileName: string): string | null {
  const m = fileName.match(
    /\b(france|belgium|belgique|luxembourg|netherlands|germany|allemagne|spain|espagne|italy|italie|portugal|switzerland|suisse|austria|uk|ireland)\b/i
  );
  if (!m) return null;
  const s = m[1].toLowerCase();
  const map: Record<string, string> = {
    belgique: "Belgium", allemagne: "Germany", espagne: "Spain",
    italie: "Italy", suisse: "Switzerland",
  };
  return map[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}
