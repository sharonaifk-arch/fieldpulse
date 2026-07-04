/** Presentation-only formatting helpers. */
export const pct = (v: number | null): string =>
  v === null ? "—" : `${Math.round(v * 1000) / 10}%`;

export const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("fr-FR").format(v);

export const shortDate = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export const fileSize = (bytes: number): string =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`;
