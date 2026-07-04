/**
 * Helpers d'animation GSAP — durées 150–300ms (micro) / 700ms (count-up),
 * ease-out en entrée, prefers-reduced-motion respecté partout.
 * (Une seule lib d'animation dans le projet : GSAP.)
 */
import { useEffect, useRef } from "react";
import gsap from "gsap";

export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Compteur animé : renvoie une ref à poser sur le <span> cible. */
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
    const tw = gsap.to(obj, {
      v: value,
      duration: 0.7,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = fmt(obj.v);
      },
    });
    prev.current = value;
    return () => {
      tw.kill();
    };
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
      gsap.set(items, { opacity: 1, clearProps: "all" });
      return;
    }
    const tw = gsap.fromTo(
      items,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.28, stagger: 0.04, ease: "power2.out", clearProps: "transform" }
    );
    return () => {
      tw.kill();
      gsap.set(items, { opacity: 1, clearProps: "all" });
    };
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
    const tw = gsap.fromTo(
      el,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.22, ease: "power2.out", clearProps: "all" }
    );
    return () => {
      tw.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}
