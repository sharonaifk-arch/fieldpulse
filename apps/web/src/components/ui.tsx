/** Small design-system primitives — dark-first, Linear/Vercel-inspired. */
import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X, TrendingDown, TrendingUp } from "lucide-react";
import type { ClosureStatus, FormStatus } from "@facm/core";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { useCountUp } from "../anim";

/* ---------- Card : ombre douce, bordure quasi invisible ---------- */
export function Card({ children, className = "", title, right }: {
  children: ReactNode; className?: string; title?: string; right?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl bg-surface shadow-[var(--shadow)] ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
          {title && <h3 className="text-[11.5px] font-semibold uppercase tracking-wider text-muted">{title}</h3>}
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ---------- KPI card : icône teintée + gros chiffre animé (anime.js) ---------- */
export type KpiTone = "ok" | "warn" | "mid" | "bad" | "accent" | "amber" | "idle";

const KPI_TONES: Record<KpiTone, { bg: string; fg: string }> = {
  ok: { bg: "bg-ok-soft", fg: "text-ok" },
  warn: { bg: "bg-warn-soft", fg: "text-warn" },
  mid: { bg: "bg-mid-soft", fg: "text-mid" },
  bad: { bg: "bg-bad-soft", fg: "text-bad" },
  accent: { bg: "bg-accent-soft", fg: "text-accent" },
  amber: { bg: "bg-amber-soft", fg: "text-amber" },
  idle: { bg: "bg-idle-soft", fg: "text-idle" },
};

/** Stat-card style DashStack : label + icône carrée colorée en haut, gros
 *  chiffre animé, ligne de tendance (delta) en bas. */
export function KpiCard({ label, value, sub, tone = "idle", icon, trend, format }: {
  label: string; value: ReactNode; sub?: string; tone?: KpiTone;
  icon?: ReactNode;
  /** tendance vs analyse précédente : delta signé + si une baisse est positive */
  trend?: { delta: number | null; goodWhenDown?: boolean };
  /** formatage du compteur animé quand value est un nombre */
  format?: (v: number) => string;
}) {
  const t = KPI_TONES[tone];
  const numeric = typeof value === "number";
  const countRef = useCountUp(numeric ? (value as number) : 0, format);

  let trendEl: ReactNode = null;
  if (trend && trend.delta !== null && trend.delta !== 0) {
    const good = trend.goodWhenDown ? trend.delta < 0 : trend.delta > 0;
    trendEl = (
      <span className={`inline-flex items-center gap-1 font-data text-[11px] font-semibold ${good ? "text-ok" : "text-bad"}`}>
        {trend.delta > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
        {trend.delta > 0 ? "+" : ""}{trend.delta}
      </span>
    );
  }

  return (
    <div className="anim-item flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-[var(--shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        {icon && (
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${t.bg} ${t.fg}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="font-data text-[30px] font-bold leading-9 text-ink">
        {numeric ? <span ref={countRef}>{String(value)}</span> : value}
      </div>
      {(sub || trendEl) && (
        <div className="flex items-center gap-2">
          {trendEl}
          {sub && <span className="truncate text-[11px] text-faint">{sub}</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- status badges (discreet pill + dot) ---------- */
const STATUS_TONE: Record<ClosureStatus, { dot: string; bg: string; fg: string }> = {
  ready: { dot: "bg-ok", bg: "bg-ok-soft", fg: "text-ok" },
  "waiting-forms": { dot: "bg-warn", bg: "bg-warn-soft", fg: "text-warn" },
  "waiting-reconciliation": { dot: "bg-mid", bg: "bg-mid-soft", fg: "text-mid" },
  blocked: { dot: "bg-bad", bg: "bg-bad-soft", fg: "text-bad" },
  pending: { dot: "bg-idle", bg: "bg-idle-soft", fg: "text-idle" },
};

export function StatusBadge({ status }: { status: ClosureStatus }) {
  const t = useT();
  const tone = STATUS_TONE[status] ?? STATUS_TONE.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.fg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {t(`status.${status}` as never)}
    </span>
  );
}

const FORM_TONE: Record<FormStatus, string> = {
  received: "text-ok bg-ok-soft",
  gfe: "text-accent bg-accent-soft",
  open: "text-warn bg-warn-soft",
  excluded: "text-faint bg-idle-soft",
  review: "text-bad bg-bad-soft",
};

export function FormBadge({ status }: { status: FormStatus }) {
  const t = useT();
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${FORM_TONE[status]}`}>
      {t(`form.${status}` as never)}
    </span>
  );
}

/* ---------- buttons ---------- */
export function Button({ children, onClick, variant = "default", disabled, className = "", type }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
  variant?: "default" | "primary" | "ghost" | "danger"; type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    default: "border border-line bg-surface-2 text-ink hover:border-line-strong",
    primary: "bg-accent text-white hover:opacity-90",
    ghost: "text-muted hover:text-ink hover:bg-surface-2",
    danger: "border border-line text-bad hover:bg-bad-soft",
  };
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-[background-color,color,border-color,transform] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/* ---------- form inputs ---------- */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] text-ink placeholder:text-faint outline-none focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-muted hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-(--accent)"
      />
      {label}
    </label>
  );
}

/* ---------- skeleton / empty / progress ---------- */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line py-16 text-center">
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {body && <div className="max-w-sm text-[12.5px] text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const p = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${p}%` }} />
    </div>
  );
}

/* ---------- toasts ---------- */
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const icons = {
    success: <CheckCircle2 size={15} className="text-ok" />,
    error: <AlertTriangle size={15} className="text-bad" />,
    info: <Info size={15} className="text-accent" />,
  };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-enter pointer-events-auto flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-ink shadow-[var(--shadow)]"
        >
          {icons[t.kind]}
          <span className="max-w-xs">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="ml-1 text-faint hover:text-ink">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
