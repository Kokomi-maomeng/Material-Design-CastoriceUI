import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useI18n } from "../../lib/i18n";

const dialogStack: HTMLDivElement[] = [];
let bodyOverflow = "";
const focusableSelector = 'a[href], summary, button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const syncDialogStack = () => {
  dialogStack.forEach((dialog, index) => {
    const covered = index !== dialogStack.length - 1;
    dialog.inert = covered;
    dialog.setAttribute("aria-modal", String(!covered));
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
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogStack.length === 0) bodyOverflow = document.body.style.overflow;
    dialogStack.push(dialog);
    syncDialogStack();
    document.body.style.overflow = "hidden";
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
      const details = element.closest("details:not([open])");
      return !element.closest("[hidden], [inert]") && (!details || details.querySelector("summary")?.contains(element));
    });
    (focusableElements()[0] ?? dialog).focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (dialogStack.at(-1) !== dialog || event.defaultPrevented) return;
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
      const wasTop = dialogStack.at(-1) === dialog;
      const index = dialogStack.indexOf(dialog);
      if (index !== -1) dialogStack.splice(index, 1);
      syncDialogStack();
      if (dialogStack.length === 0) document.body.style.overflow = bodyOverflow;
      if (wasTop && previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="md-dialog-layer">
      <button className="md-dialog-scrim" type="button" aria-label={t("关闭对话框", "Close dialog")} onClick={onClose} />
      <div
        ref={dialogRef}
        className={`md-dialog md-dialog--${size} ${className}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
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
