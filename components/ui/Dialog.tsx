import { useEffect, useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useI18n } from "../../lib/i18n";
import { usePresence } from "./usePresence";

const dialogStack: HTMLDivElement[] = [];
let rootWasInert = false;
let scrollPosition = { left: 0, top: 0 };
const restoreBackgroundScroll = () => {
  if (window.scrollX !== scrollPosition.left || window.scrollY !== scrollPosition.top) window.scrollTo(scrollPosition.left, scrollPosition.top);
};
const blockBackgroundScroll = (event: Event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".md-dialog__content, .md-select-menu, .md-date-picker, .md-anchored-popover")) event.preventDefault();
};
const focusableSelector = 'a[href], summary, button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const syncDialogStack = () => {
  dialogStack.forEach((dialog, index) => {
    const covered = index !== dialogStack.length - 1;
    dialog.inert = covered;
    dialog.setAttribute("aria-modal", String(!covered));
    dialog.setAttribute("aria-hidden", String(covered));
    const layer = dialog.parentElement;
    if (layer) {
      layer.inert = covered;
      layer.style.zIndex = String(100 + index * 2);
    }
  });
};

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  size?: "small" | "medium" | "large";
  className?: string;
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  actions,
  size = "medium",
  className = "",
}: DialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const present = usePresence(open);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!present || !dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogStack.length === 0) {
      scrollPosition = { left: window.scrollX, top: window.scrollY };
      window.addEventListener("scroll", restoreBackgroundScroll);
      const root = document.getElementById("root");
      rootWasInert = root?.inert ?? false;
      if (root) root.inert = true;
      document.documentElement.classList.add("has-dialog");
      document.addEventListener("wheel", blockBackgroundScroll, { passive: false });
      document.addEventListener("touchmove", blockBackgroundScroll, { passive: false });
    }
    dialogStack.push(dialog);
    syncDialogStack();
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
      const details = element.closest("details:not([open])");
      return !element.closest("[hidden], [inert]") && (!details || details.querySelector("summary")?.contains(element));
    });
    (focusableElements()[0] ?? dialog).focus({ preventScroll: true });
    restoreBackgroundScroll();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!openRef.current || dialogStack[dialogStack.length - 1] !== dialog || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      // Date/select popups use their own keyboard handling in a body portal.
      if (document.activeElement?.closest(".md-select-menu, .md-date-picker")) return;
      const focusable = focusableElements();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const wasTop = dialogStack[dialogStack.length - 1] === dialog;
      const index = dialogStack.indexOf(dialog);
      if (index !== -1) dialogStack.splice(index, 1);
      syncDialogStack();
      if (dialogStack.length === 0) {
        restoreBackgroundScroll();
        const root = document.getElementById("root");
        if (root) root.inert = rootWasInert;
        document.documentElement.classList.remove("has-dialog");
        document.removeEventListener("wheel", blockBackgroundScroll);
        document.removeEventListener("touchmove", blockBackgroundScroll);
        window.removeEventListener("scroll", restoreBackgroundScroll);
      }
      if (wasTop && previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")) previouslyFocused.focus({ preventScroll: true });
    };
  }, [present]);

  if (!present) return null;

  return createPortal(
    <div className={`md-dialog-layer ${open ? "is-open" : "is-closing"}`} aria-hidden={!open}>
      <button className="md-dialog-scrim" type="button" aria-label={t("关闭对话框", "Close dialog")} onClick={onClose} disabled={!open} />
      <div
        ref={dialogRef}
        className={`md-dialog md-dialog--${size} ${className}`}
        role="dialog"
        tabIndex={-1}
        aria-modal={open ? "true" : "false"}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
      <div className="md-dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <Button variant="text" icon="close" aria-label={t("关闭", "Close")} onClick={onClose} />
      </div>
      <div className="md-dialog__content">{children}</div>
      {actions ? <div className="md-dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
