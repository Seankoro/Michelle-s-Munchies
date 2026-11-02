// Client-side memory of how the visitor moved around the site in this tab, so
// "Back" can mean the page they actually came from, and a page they return to
// can put them back where they were. Module state on purpose: it lives exactly
// as long as the loaded document, so a refresh or a visit arriving from another
// site starts clean, and a "Back" link can never send anyone off the site.

/** The in-site pages of this document's history, oldest first. */
let entries: string[] = [];
/** Which entry is showing now. */
let index = -1;
/** Set by a browser back or forward, until the next page records itself. */
let traversing = false;
/** The page the visitor most recently arrived on by going back or forward. */
let returnedTo: string | null = null;

const listeners = new Set<() => void>();
let snapshot: NavSnapshot = { current: null, previous: null };

export type NavSnapshot = {
  /** The page showing now, once recorded. */
  current: string | null;
  /** The in-site page before it, or null when there is none to go back to. */
  previous: string | null;
};

function publish() {
  snapshot = {
    current: entries[index] ?? null,
    previous: index > 0 ? entries[index - 1] : null,
  };
  listeners.forEach((listener) => listener());
}

/**
 * Called on every browser back or forward, before the new page renders. The
 * restores below key off this, so they run on a return but not on a fresh visit.
 */
export function noteTraversal() {
  traversing = true;
  returnedTo = window.location.pathname;
}

/** Record the page now showing. Called by NavigationTracker on each path change. */
export function recordPage(path: string) {
  if (entries[index] === path) return;
  if (traversing && index > 0 && entries[index - 1] === path) {
    index -= 1;
  } else if (traversing && entries[index + 1] === path) {
    index += 1;
  } else {
    // A link, or a traversal we cannot place: start a new branch here, as the
    // browser does when you follow a link after going back.
    entries = [...entries.slice(0, index + 1), path];
    index = entries.length - 1;
    if (!traversing) returnedTo = null;
  }
  traversing = false;
  publish();
}

/** True when this page was reached with back or forward, so it should restore. */
export function isReturningTo(path: string): boolean {
  return returnedTo === path;
}

export function subscribeNav(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNavSnapshot(): NavSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: NavSnapshot = { current: null, previous: null };

/** The server knows no history, so every page renders its fallback there. */
export function getServerNavSnapshot(): NavSnapshot {
  return SERVER_SNAPSHOT;
}
