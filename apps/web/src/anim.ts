/**
 * anime.js v4 helpers — durées 150–300ms (micro) / 700ms (count-up),
 * ease-out en entrée, prefers-reduced-motion respecté partout.
 */
import { useEffect, useRef } from "react";
import { animate, engine, stagger } from "animejs";

// Ne jamais geler les animations quand la fenêtre est cachée : sinon une app
// démarrée minimisée (ou un webview en arrière-plan) reste bloquée sur la
// frame initiale opacity:0 — dashboard invisible jusqu'au prochain focus.
engine.pauseOnDocumentHidden = false;

export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Compteur KPI animé : renvoie une ref à poser sur le <span> cible. */
export function useCountUp(value: number, format?: (v: number) => string) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || prev.current === value) {
      el.textContent = fmt(value);
      prev.current = value;
      return;
    }
    const obj = { v: prev.current };
    const a = animate(obj, {
      v: value,
      duration: 700,
      ease: "outCubic",
      onUpdate: () => { el.textContent = fmt(obj.v); },
    });
    prev.current = value;
    return () => { a.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return ref;
}

/**
 * Entrée en cascade des éléments `.anim-item` du conteneur (30–50ms de
 * décalage par item, translate+fade 250ms ease-out).
 */
export function useStaggerIn(deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = root.querySelectorAll<HTMLElement>(".anim-item");
    if (items.length === 0) return;
    if (reducedMotion()) {
      items.forEach((el) => (el.style.opacity = "1"));
      return;
    }
    const a = animate(items, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 250,
      delay: stagger(38),
      ease: "outQuad",
    });
    return () => { a.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Transition d'entrée de page (fade + léger slide, 220ms). */
export function usePageEnter(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const a = animate(el, {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 220,
      ease: "outQuad",
    });
    return () => { a.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}
