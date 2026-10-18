import { useEffect, useRef, type DetailsHTMLAttributes } from "react";

/** Native summary keyboard semantics with reversible height motion on all engines. */
export function AnimatedDetails({ children, className = "", ...props }: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const animation = useRef<Animation | null>(null);
  const targetOpen = useRef<boolean | null>(null);
  const finish = useRef<(() => void) | null>(null);

  useEffect(() => {
    const node = detailsRef.current;
    const summary = node?.querySelector<HTMLElement>(":scope > summary");
    if (!node || !summary) return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (media?.matches) finish.current?.(); };
    const toggle = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const expanding = !(targetOpen.current ?? node.open);
      const from = node.getBoundingClientRect().height;
      if (animation.current) animation.current.onfinish = null;
      animation.current?.cancel();
      targetOpen.current = expanding;
      node.dataset.expanded = String(expanding);
      summary.setAttribute("aria-expanded", String(expanding));
      const bodies = Array.from(node.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== summary);
      for (const body of bodies) body.inert = !expanding;
      if (!expanding && bodies.some((body) => body.contains(document.activeElement))) (summary as HTMLElement).focus({ preventScroll: true });
      node.open = expanding;
      const to = node.getBoundingClientRect().height;
      node.open = true;
      const settle = () => {
        if (animation.current) animation.current.onfinish = null;
        animation.current?.cancel();
        animation.current = null;
        node.open = expanding;
        node.style.overflow = "";
        targetOpen.current = null;
        finish.current = null;
      };
      finish.current = settle;
      if (!node.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || Math.abs(to - from) < 1) { settle(); return; }
      node.style.overflow = "hidden";
      animation.current = node.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: expanding ? 300 : 220, easing: expanding ? "cubic-bezier(.2,0,0,1)" : "cubic-bezier(.4,0,1,1)" });
      animation.current.onfinish = settle;
    };
    summary.addEventListener("click", toggle);
    media?.addEventListener?.("change", reduce);
    return () => {
      summary.removeEventListener("click", toggle);
      media?.removeEventListener?.("change", reduce);
      if (animation.current) animation.current.onfinish = null;
      animation.current?.cancel();
    };
  }, []);

  return <details {...props} ref={detailsRef} className={`motion-details ${className}`}>{children}</details>;
}
