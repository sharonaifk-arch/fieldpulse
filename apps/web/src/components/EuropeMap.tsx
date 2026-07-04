/**
 * Carte Europe interactive : pays teintés selon le statut agrégé de leurs
 * Field Actions (pire statut gagne), pulsations sur les pays à FA ouvertes,
 * tooltip KPIs, clic = filtre le Monitoring sur le pays.
 * Paths générés build-time (scripts/gen-europe-map.mjs) — zéro fetch, offline.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import gsap from "gsap";
import { useEffect, useRef } from "react";
import type { StoredSummary } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { reducedMotion } from "../anim";
import { EUROPE_COUNTRIES, MAP_H, MAP_W } from "../map/europe.gen";
import { pct } from "../format";

/** Noms FA -> noms Natural Earth. */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: "United Kingdom", "great britain": "United Kingdom", england: "United Kingdom",
  "czech republic": "Czechia", bosnia: "Bosnia and Herz.", macedonia: "North Macedonia",
  holland: "Netherlands",
};

const normalize = (name: string): string => {
  const n = name.trim().toLowerCase();
  return COUNTRY_ALIASES[n] ?? name.trim().replace(/^\w/, (c) => c.toUpperCase());
};

type Tone = "ready" | "waiting-reconciliation" | "waiting-forms" | "blocked";
const RANK: Record<Tone, number> = { ready: 0, "waiting-reconciliation": 1, "waiting-forms": 2, blocked: 3 };
const FILL: Record<Tone, { fill: string; stroke: string }> = {
  ready: { fill: "var(--green-soft)", stroke: "var(--green)" },
  "waiting-reconciliation": { fill: "var(--yellow-soft)", stroke: "var(--yellow)" },
  "waiting-forms": { fill: "var(--orange-soft)", stroke: "var(--orange)" },
  blocked: { fill: "var(--red-soft)", stroke: "var(--red)" },
};

interface CountryAgg {
  tone: Tone;
  fas: number;
  open: number;
  qtyMissing: number;
  completion: number | null;
}

function aggregate(results: StoredSummary[]): Map<string, CountryAgg> {
  const map = new Map<string, StoredSummary[]>();
  for (const r of results) {
    if (!r.country) continue;
    const key = normalize(r.country);
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const out = new Map<string, CountryAgg>();
  for (const [country, fas] of map) {
    let tone: Tone = "ready";
    for (const r of fas) {
      const t = (r.closureStatus === "pending" ? "blocked" : r.closureStatus) as Tone;
      if (RANK[t] > RANK[tone]) tone = t;
    }
    const expected = fas.reduce((s, r) => s + r.kpis.expectedResponses, 0);
    const answered = fas.reduce((s, r) => s + r.kpis.formsReceived + r.kpis.closedByGfe, 0);
    out.set(country, {
      tone,
      fas: fas.length,
      open: fas.reduce((s, r) => s + r.kpis.openResponses, 0),
      qtyMissing: fas.reduce((s, r) => s + r.kpis.qtyMissing, 0),
      completion: expected > 0 ? answered / expected : null,
    });
  }
  return out;
}

export function EuropeMap({ results }: { results: StoredSummary[] }) {
  const t = useT();
  const nav = useNavigate();
  const setMonitoringSearch = useAppStore((s) => s.setMonitoringSearch);
  const [tip, setTip] = useState<{ name: string; agg: CountryAgg | null; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const byCountry = useMemo(() => aggregate(results), [results]);

  // intro GSAP : pays qui apparaissent en cascade, puis marqueurs qui surgissent.
  // On n'anime QUE opacity/scale des enfants (jamais le SVG racine) + clearProps
  // complet : si la timeline est tuée au changement de route, rien ne reste figé.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || reducedMotion()) return;
    const paths = svg.querySelectorAll<SVGPathElement>("path[data-country]");
    const markers = svg.querySelectorAll<SVGGElement>("[data-marker]");
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.fromTo(paths, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.01, clearProps: "all" }, 0)
      .fromTo(
        markers,
        { scale: 0, transformOrigin: "center", svgOrigin: "" },
        { scale: 1, duration: 0.35, ease: "back.out(2.2)", stagger: 0.06, clearProps: "scale" },
        0.4
      );
    return () => {
      tl.kill();
      gsap.set(paths, { clearProps: "all" });
      gsap.set(markers, { clearProps: "all" });
    };
  }, []);

  const active = EUROPE_COUNTRIES.filter((c) => byCountry.has(c.name));
  const pulsing = active.filter((c) => byCountry.get(c.name)!.tone !== "ready");

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${t("map.aria")} — ${active.map((c) => c.name).join(", ")}`}
        className="mx-auto block max-h-[360px] w-full select-none"
        onMouseLeave={() => setTip(null)}
      >
        {EUROPE_COUNTRIES.map((c) => {
          const agg = byCountry.get(c.name);
          const style = agg ? FILL[agg.tone] : { fill: "var(--map-land)", stroke: "var(--map-stroke)" };
          return (
            <path
              key={c.name}
              data-country={c.name}
              d={c.d}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={agg ? 1.4 : 0.7}
              tabIndex={agg ? 0 : -1}
              aria-label={agg ? `${c.name}: ${agg.fas} FA, ${agg.open} ${t("kpi.openResponses")}` : undefined}
              className={agg ? "cursor-pointer transition-[filter] duration-150 hover:brightness-150 focus:brightness-150" : ""}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({ name: c.name, agg: agg ?? null, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onClick={() => {
                if (!agg) return;
                setMonitoringSearch(c.name);
                nav("/monitoring");
              }}
              onKeyDown={(e) => {
                if (agg && (e.key === "Enter" || e.key === " ")) {
                  setMonitoringSearch(c.name);
                  nav("/monitoring");
                }
              }}
            />
          );
        })}

        {/* pulsations sur pays avec FA non clôturées */}
        {pulsing.map((c) => {
          const tone = byCountry.get(c.name)!.tone;
          return (
            <g key={`pulse-${c.name}`} data-marker>
              <circle cx={c.cx} cy={c.cy} r={4} fill={FILL[tone].stroke} />
              <circle
                cx={c.cx} cy={c.cy} r={5}
                fill="none" stroke={FILL[tone].stroke} strokeWidth={1.5}
                style={{ animation: "map-pulse 1.8s ease-out infinite", transformBox: "fill-box", transformOrigin: "center" }}
              />
            </g>
          );
        })}
        {/* points fixes sur pays prêtes à clôturer */}
        {active
          .filter((c) => byCountry.get(c.name)!.tone === "ready")
          .map((c) => (
            <g key={`dot-${c.name}`} data-marker>
              <circle cx={c.cx} cy={c.cy} r={4} fill="var(--green)" />
            </g>
          ))}
      </svg>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow)]"
          style={{ left: Math.min(tip.x + 14, 520), top: tip.y + 10 }}
        >
          <div className="font-medium text-ink">{tip.name}</div>
          {tip.agg ? (
            <div className="mt-1 space-y-0.5 text-muted">
              <div>{tip.agg.fas} FA · {t("kpi.completion")} <b className="font-data text-ink">{pct(tip.agg.completion)}</b></div>
              <div>{t("kpi.openResponses")} <b className={`font-data ${tip.agg.open ? "text-warn" : "text-ink"}`}>{tip.agg.open}</b>
                {" · "}{t("kpi.qtyMissing")} <b className={`font-data ${tip.agg.qtyMissing ? "text-mid" : "text-ink"}`}>{tip.agg.qtyMissing}</b></div>
              <div className="text-[10.5px] text-faint">{t("map.click")}</div>
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-faint">{t("map.none")}</div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px] text-muted">
        {(["ready", "waiting-forms", "waiting-reconciliation", "blocked"] as Tone[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: FILL[s].stroke }} />
            {t(`status.${s}` as never)}
          </span>
        ))}
        <span className="ml-auto">{active.length} {t("map.countries")}</span>
      </div>
    </div>
  );
}
