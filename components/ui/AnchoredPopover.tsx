"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type PointerEventHandler, type ReactNode, type RefObject } from "react";
import { usePresence } from "./usePresence";

type Placement = "left" | "right" | "top" | "bottom";

interface AnchoredPopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  preferredWidth?: number;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: Placement;
  ready: boolean;
}

const VIEWPORT_EDGE = 12;
const SURFACE_GAP = 12;

export function AnchoredPopover({
  open,
  anchorRef,
  surfaceRef,
  onClose,
  ariaLabel,
  children,
  className = "",
  preferredWidth = 304,
  onPointerEnter,
  onPointerLeave,
}: AnchoredPopoverProps) {
  const present = usePresence(open, 180);
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    left: VIEWPORT_EDGE,
    top: VIEWPORT_EDGE,
    width: preferredWidth,
    maxHeight: 360,
    placement: "bottom",
    ready: false,
  });

  const positionPanel = useCallback(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.max(1, Math.min(preferredWidth, viewportWidth - VIEWPORT_EDGE * 2));
    const maxHeight = Math.max(1, Math.min(360, viewportHeight - VIEWPORT_EDGE * 2));
    const measuredHeight = Math.min(popup.scrollHeight || maxHeight, maxHeight);
    const anchorRect = anchor.getBoundingClientRect();
    const surfaceRect = surfaceRef?.current?.getBoundingClientRect() ?? anchorRect;
    const roomRight = viewportWidth - surfaceRect.right - SURFACE_GAP - VIEWPORT_EDGE;
    const roomLeft = surfaceRect.left - SURFACE_GAP - VIEWPORT_EDGE;

    let placement: Placement;
    let left: number;
    let top: number;

    if (viewportWidth >= 760 && Math.max(roomRight, roomLeft) >= Math.min(width, 220)) {
      placement = roomRight >= width || roomRight >= roomLeft ? "right" : "left";
      left = placement === "right" ? surfaceRect.right + SURFACE_GAP : surfaceRect.left - SURFACE_GAP - width;
      top = anchorRect.top - 12;
    } else {
      const roomBelow = viewportHeight - surfaceRect.bottom - SURFACE_GAP - VIEWPORT_EDGE;
      const roomAbove = surfaceRect.top - SURFACE_GAP - VIEWPORT_EDGE;
      placement = roomBelow >= measuredHeight || roomBelow >= roomAbove ? "bottom" : "top";
      left = Math.min(surfaceRect.left, viewportWidth - width - VIEWPORT_EDGE);
      top = placement === "bottom" ? surfaceRect.bottom + SURFACE_GAP : surfaceRect.top - SURFACE_GAP - measuredHeight;
    }

    setPosition({
      left: Math.max(VIEWPORT_EDGE, Math.min(left, viewportWidth - width - VIEWPORT_EDGE)),
      top: Math.max(VIEWPORT_EDGE, Math.min(top, viewportHeight - measuredHeight - VIEWPORT_EDGE)),
      width,
      maxHeight,
      placement,
      ready: true,
    });
  }, [anchorRef, preferredWidth, surfaceRef]);

  useEffect(() => {
    if (!present) return;
    const frame = window.requestAnimationFrame(positionPanel);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, positionPanel, present]);

  if (!present || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popupRef}
      className={`md-anchored-popover md-floating-panel ${className} ${open ? "is-open" : "is-closing"}`}
      data-placement={position.placement}
      role="dialog"
      aria-label={ariaLabel}
      aria-hidden={!open}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
