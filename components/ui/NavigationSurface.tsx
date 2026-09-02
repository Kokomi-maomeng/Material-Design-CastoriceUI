import { useEffect, useRef, type HTMLAttributes } from "react";

const controls = 'a,button,input,select,textarea,summary,[contenteditable="true"],[data-no-navigate],[role="button"],[role="link"]';

/** Navigation must never consume a selection, a drag, or a nested control. */
export function useNavigationSurface(onNavigate: () => void, label: string): HTMLAttributes<HTMLElement> {
  const gesture = useRef({ x: 0, y: 0, moved: false, selected: false });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (pending.current !== null) clearTimeout(pending.current); pending.current = null; };
  useEffect(() => cancel, []);
  const hasSelection = () => Boolean(window.getSelection()?.toString());
  const isControl = (target: EventTarget, surface: HTMLElement) => {
    const control = target instanceof Element ? target.closest(controls) : null;
    return Boolean(control && control !== surface && surface.contains(control));
  };
  return {
    role: "link",
    tabIndex: 0,
    "aria-label": label,
    onPointerDown: (event) => {
      cancel();
      gesture.current = { x: event.clientX, y: event.clientY, moved: false, selected: hasSelection() };
    },
    onPointerMove: (event) => {
      if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 5) gesture.current.moved = true;
    },
    onClick: (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isControl(event.target, event.currentTarget)) return;
      if (hasSelection() || (event.detail > 0 && (gesture.current.selected || gesture.current.moved))) return;
      // Allow double-click selection of text before committing navigation.
      if (event.detail > 0 && event.target !== event.currentTarget) {
        pending.current = setTimeout(() => { if (!hasSelection()) onNavigate(); pending.current = null; }, 280);
      } else onNavigate();
    },
    onDoubleClick: cancel,
    onPointerCancel: () => { cancel(); gesture.current.moved = true; },
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget || event.key !== "Enter" || event.repeat || hasSelection()) return;
      event.preventDefault();
      onNavigate();
    },
  };
}
