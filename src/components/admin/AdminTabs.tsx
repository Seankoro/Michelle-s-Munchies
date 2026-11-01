"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type AdminTab<T extends string> = { id: T; label: string };

/** The id of a tab panel, for the `id` of the element it controls. */
export function tabPanelId(prefix: string, id: string) {
  return `${prefix}-panel-${id}`;
}

/** The id of a tab button, for the panel's `aria-labelledby`. */
export function tabButtonId(prefix: string, id: string) {
  return `${prefix}-tab-${id}`;
}

/**
 * A row of pill tabs that splits a long admin screen into short ones. On a
 * phone the row scrolls sideways rather than wrapping, and the chosen tab is
 * kept in view. Left and right arrow keys move between tabs, as screen
 * readers expect of a tab list.
 *
 * The caller renders each panel with `role="tabpanel"`, the ids above and
 * `hidden` when it is not the active one. Hiding rather than unmounting keeps
 * what was typed on one tab while another is open.
 */
export function AdminTabs<T extends string>({
  tabs,
  active,
  onChange,
  idPrefix,
  label,
  className,
}: {
  tabs: AdminTab<T>[];
  active: T;
  onChange: (id: T) => void;
  idPrefix: string;
  /** What the tabs divide, for screen readers, e.g. "Product sections". */
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const button = listRef.current?.querySelector<HTMLElement>(`[aria-selected="true"]`);
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    onChange(tabs[next].id);
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(tabButtonId(idPrefix, tabs[next].id))}`)
      ?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex gap-2 overflow-x-auto no-scrollbar", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabButtonId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition active:scale-95",
              selected
                ? "border-rose bg-blush-soft text-rose-ink"
                : "border-line bg-white text-ink hover:border-rose",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
