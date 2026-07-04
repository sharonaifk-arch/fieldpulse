/** Recharts wrappers + visuels custom, thémés via variables CSS. */
import { useEffect, useRef } from "react";
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import gsap from "gsap";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { StoredSummary } from "../api";
import { useT } from "../i18n";
import { reducedMotion, useCountUp } from "../anim";

const css = (name: string) => `var(--${name})`;

const tooltipStyle = {
  background: css("surface"),
  border: `1px solid ${css("border")}`,
  borderRadius: 8,
  fontSize: 12,
  color: css("text"),
};

/* ---------- anneau de progression animé (KPI héros) ---------- */
export function ProgressRing({ ratio, label, sub }: { ratio: number | null; label: string; sub?: string }) {
  const pctValue = ratio === null ? 0 : Math.round(ratio * 100);
  const circleRef = useRef<SVGCircleElement>(null);
  const countRef = useCountUp(pctValue, (v) => `${Math.round(v)}`);
  const R = 34;
  const CIRC = 2 * Math.PI * R;

  useEffect(() => {
    const c = circleRef.current;
    if (!c) return;
    const target = CIRC * (1 - pctValue / 100);
    if (reducedMotion()) {
      c.style.strokeDashoffset = String(target);
      return;
    }
    const tw = gsap.fromTo(c, { strokeDashoffset: CIRC }, { strokeDashoffset: target, duration: 0.9, ease: "power3.out" });
    return () => { tw.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pctValue]);

  return (
    <div className="anim-item flex items-center gap-3.5 rounded-2xl bg-surface px-4 py-3 shadow-[var(--shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)]">
      <svg width="76" height="76" viewBox="0 0 84 84" className="shrink-0 -rotate-90">
        <circle cx="42" cy="42" r={R} fill="none" stroke={css("surface-2")} strokeWidth="8" />
        <circle
          ref={circleRef}
          cx="42" cy="42" r={R} fill="none"
          stroke={css("accent")} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC}
        />
      </svg>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
        <div className="font-data text-[26px] font-semibold leading-8 text-ink">
          <span ref={countRef}>0</span>
          <span className="text-[15px] text-muted">%</span>
        </div>
        {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
      </div>
    </div>
  );
}

/* ---------- sparkline (évolution par FA depuis l'historique des runs) ---------- */
export function Sparkline({ values, color = "var(--accent)", w = 140, h = 36 }: {
  values: number[]; color?: string; w?: number; h?: number;
}) {
  if (values.length < 2) {
    return <div className="text-[11px] text-faint">—</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (w - 6) + 3,
    h - 5 - ((v - min) / span) * (h - 10),
  ]);
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
    </svg>
  );
}

/* ---------- delta vs analyse précédente ---------- */
export function DeltaBadge({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null || delta === 0) return null;
  // pour "réponses ouvertes"/"qté manquante", une baisse est une bonne nouvelle
  const good = invert ? delta > 0 : delta < 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-data text-[10.5px] font-semibold ${
        good ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"
      }`}
      title="vs analyse précédente"
    >
      {delta > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(delta)}
    </span>
  );
}

/* ---------- global completion donut ---------- */
export function CompletionDonut({ results }: { results: StoredSummary[] }) {
  const t = useT();
  const received = results.reduce((s, r) => s + r.kpis.formsReceived, 0);
  const gfe = results.reduce((s, r) => s + r.kpis.closedByGfe, 0);
  const open = results.reduce((s, r) => s + r.kpis.openResponses, 0);
  const total = received + gfe + open;
  const rate = total > 0 ? Math.round(((received + gfe) / total) * 100) : 0;
  const data = [
    { name: t("kpi.received"), value: received, color: css("green") },
    { name: t("kpi.gfe"), value: gfe, color: css("accent") },
    { name: t("kpi.openResponses"), value: open, color: css("orange") },
  ].filter((d) => d.value > 0);

  return (
    <div className="relative h-52">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data.length ? data : [{ name: "—", value: 1, color: css("border") }]}
               dataKey="value" innerRadius={62} outerRadius={82} paddingAngle={2} strokeWidth={0}>
            {(data.length ? data : [{ color: css("border") }]).map((d, i) => (
              <Cell key={i} fill={(d as { color: string }).color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-ink">{rate}%</span>
        <span className="text-[10.5px] uppercase tracking-wider text-faint">{t("kpi.completion")}</span>
      </div>
    </div>
  );
}

/* ---------- quantities bar (per FA) ---------- */
export function QtyBars({ results }: { results: StoredSummary[] }) {
  const data = results
    .filter((r) => r.trackingMode === "vf")
    .map((r) => ({
      name: r.faRef,
      attendu: r.kpis.qtyToReturn,
      recu: r.kpis.qtyReceived,
      manquant: r.kpis.qtyMissing,
    }));
  return (
    <div className="h-52">
      <ResponsiveContainer>
        <BarChart data={data} barSize={14}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: css("text-faint") }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: css("text-faint") }} axisLine={false} tickLine={false} width={30} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: css("surface-2") }} />
          <Bar dataKey="attendu" fill={css("border-strong")} radius={[3, 3, 0, 0]} />
          <Bar dataKey="recu" fill={css("green")} radius={[3, 3, 0, 0]} />
          <Bar dataKey="manquant" fill={css("red")} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- top cities by missing qty ---------- */
export function TopCities({ results }: { results: StoredSummary[] }) {
  const byCity = new Map<string, number>();
  for (const r of results)
    for (const s of r.soldToSummaries)
      if (s.qtyMissing > 0) byCity.set(s.city || "—", (byCity.get(s.city || "—") ?? 0) + s.qtyMissing);
  const data = [...byCity.entries()]
    .map(([city, qty]) => ({ city, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" barSize={12}>
          <XAxis type="number" tick={{ fontSize: 10, fill: css("text-faint") }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="city" width={130} tick={{ fontSize: 10.5, fill: css("text-muted") }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: css("surface-2") }} />
          <Bar dataKey="qty" fill={css("orange")} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- action type / status breakdowns ---------- */
export function BreakdownBars({ entries, color }: { entries: Array<{ label: string; value: number }>; color?: string }) {
  const max = Math.max(...entries.map((e) => e.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {entries.map((e) => (
        <div key={e.label} className="flex items-center gap-3">
          <span className="w-44 truncate text-[12px] text-muted">{e.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${(e.value / max) * 100}%`, background: color ?? css("accent") }}
            />
          </div>
          <span className="w-12 text-right text-[12px] tabular-nums text-ink">{e.value}</span>
        </div>
      ))}
    </div>
  );
}
