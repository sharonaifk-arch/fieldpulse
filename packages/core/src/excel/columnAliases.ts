/**
 * Column alias system: maps the many real-world header variants found in BSC
 * Customer Lists to canonical keys. Matching happens on a normalized form
 * (lowercase, punctuation stripped, whitespace collapsed).
 *
 * Order matters within a matcher: the first canonical key whose test passes
 * wins for a given header. "vf" must be an EXACT match because
 * "Qty to return (stated on VF)" also contains "vf".
 */

export function normalizeHeader(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[().,/\\?_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Matcher {
  key: string;
  test: (normalized: string) => boolean;
}

const eq =
  (...values: string[]) =>
  (n: string) =>
    values.includes(n);
const starts =
  (...prefixes: string[]) =>
  (n: string) =>
    prefixes.some((p) => n.startsWith(p));

/** Ordered matchers — first hit wins for a header cell. */
export const COLUMN_MATCHERS: Matcher[] = [
  { key: "soldTo", test: eq("sold to") },
  { key: "originalSoldTo", test: eq("original sold to") },
  { key: "shipTo", test: eq("ship to") },
  { key: "hospitalName", test: eq("hospital name", "customer name") },
  { key: "city", test: eq("city") },
  { key: "country", test: eq("country", "country name", "country code") },
  { key: "materialNumber", test: eq("material number", "material", "current part number") },
  { key: "batchNumber", test: eq("batch number", "batch", "lot number", "serial") },
  { key: "qtySent", test: eq("qty sent", "quantity sent") },
  {
    key: "qtyToReturn",
    test: (n) =>
      starts("qty to return", "qty to be corrected", "quantity to return")(n) ||
      eq("qty correct", "qty to correct")(n),
  },
  // exact match only: "qty to return (stated on vf)" also contains "vf"
  { key: "vf", test: eq("vf") },
  { key: "acknForm", test: eq("ackn form", "acknowledgement form", "ack form", "af") },
  {
    key: "formDate",
    test: starts("date vf received", "date form received", "date received vf", "date ackn"),
  },
  { key: "notif2Date", test: starts("2nd notif date", "second notif date") },
  { key: "notif2Type", test: starts("2nd notif type", "second notif type") },
  { key: "notif3Date", test: starts("3rd notif date", "third notif date") },
  { key: "notif3Type", test: starts("3rd notif type", "third notif type") },
  { key: "rga", test: (n) => eq("rga", "rga number")(n) || starts("rga if app")(n) },
  { key: "qtyReceivedLocal", test: starts("qty received local") },
  { key: "qtyReceivedDc", test: starts("qty received at dc", "qty received dc") },
  { key: "dateReceivedDc", test: starts("date received at dc", "date received dc", "date of correction") },
  { key: "salesOrder", test: eq("sales order") },
  { key: "customerPo", test: eq("customer po") },
  { key: "salesOrderType", test: eq("sales order type") },
  { key: "shippedDate", test: eq("shipped date") },
  { key: "materialDescription", test: eq("material description") },
  { key: "notes", test: starts("notes rationale", "notes", "comments") },
];

/** Keys that identify a tracking sheet (used for sheet/header scoring). */
export const SCORE_WEIGHTS: Record<string, number> = {
  soldTo: 4,
  vf: 5,
  acknForm: 5,
  qtyToReturn: 3,
  formDate: 3,
  qtySent: 2,
  hospitalName: 2,
  notif2Date: 2,
  notif3Date: 2,
  rga: 2,
  qtyReceivedDc: 2,
  batchNumber: 1,
  materialNumber: 1,
  city: 1,
  country: 1,
};

/** Returns the canonical key for a header cell, or null. */
export function matchHeader(raw: unknown): string | null {
  const n = normalizeHeader(raw);
  if (!n) return null;
  for (const m of COLUMN_MATCHERS) if (m.test(n)) return m.key;
  return null;
}

/**
 * Maps a header row to { canonicalKey -> column index } plus the original
 * header text per key. First column wins when a key appears twice.
 */
export function mapHeaderRow(row: unknown[]): {
  indexByKey: Record<string, number>;
  originalByKey: Record<string, string>;
} {
  const indexByKey: Record<string, number> = {};
  const originalByKey: Record<string, string> = {};
  row.forEach((cell, i) => {
    const key = matchHeader(cell);
    if (key && !(key in indexByKey)) {
      indexByKey[key] = i;
      originalByKey[key] = String(cell).trim();
    }
  });
  return { indexByKey, originalByKey };
}
