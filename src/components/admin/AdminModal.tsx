"use client";

import { useRef, type ReactNode } from "react";
import { useDialog } from "@/lib/useDialog";
import { cn } from "@/lib/cn";

/**
 * The shared admin modal shell: the backdrop, the dialog wiring (Escape, focus
 * trap, scroll lock, focus restore via useDialog), and backdrop-click-to-close.
 * Render it only while open (mount it conditionally).
 *
 * Pass `title` to get a fixed header bar (title + close button) over a scrolling
 * body, so the close button stays reachable however long the form is. Omit
 * `title` for raw mode: the caller controls the whole panel via `panelClassName`
 * and renders its own header (used by the order modals with richer headers).
 */
export function AdminModal({
  onClose,
  ariaLabel,
  title,
  maxWidthClass = "max-w-lg",
  panelClassName,
  children,
}: {
  onClose: () => void;
  ariaLabel: string;
  title?: ReactNode;
  maxWidthClass?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, panelRef);

  const panel =
    title === undefined ? (
      <div ref={panelRef} onClick={(e) => e.stopPropagation()} className={panelClassName}>
        {children}
      </div>
    ) : (
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90dvh] w-full animate-[fade-up_0.2s_ease-out] flex-col rounded-t-2xl bg-white shadow-soft sm:rounded-2xl",
          maxWidthClass,
        )}
      >
        {/* Fixed header so the close button stays reachable while the body scrolls. */}
        <div className="flex shrink-0 items-start justify-between gap-4 rounded-t-2xl border-b border-line bg-white px-6 py-4">
          <div className="min-w-0">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-blush-soft active:scale-90"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      {panel}
    </div>
  );
}
