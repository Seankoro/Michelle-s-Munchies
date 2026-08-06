import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible behavior for an open overlay/panel dialog. While `open`:
 *  - locks background scroll,
 *  - moves focus into the panel and traps Tab within it,
 *  - closes on Escape,
 *  - on close/unmount, restores focus to the element that was focused before.
 *
 * `onClose` is held in a ref so the setup runs once per open (not on every
 * render), which would otherwise yank focus back to the first field mid-typing.
 */
export function useDialog(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Lock the html element, not just body. The browser only hands body's
    // overflow to the viewport while html is visible on BOTH axes, and
    // globals.css sets overflow-x: clip on html to kill sideways scroll. That
    // makes html the scroll container, so hiding body's overflow was doing
    // nothing at all and the page carried on scrolling behind every sheet and
    // drawer. Both are set, and both are put back.
    const root = document.documentElement;
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // Focus the first focusable control, or the panel itself as a fallback.
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus?.();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab" && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      root.style.overflow = prevRootOverflow;
      document.body.style.overflow = prevBodyOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef]);
}
