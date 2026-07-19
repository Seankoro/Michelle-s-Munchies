"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A set of "ticked" keys kept in localStorage under `storageKey`, so a kitchen
 * checklist survives reloads, tab switches, and walking away mid-bake. Keys are
 * arbitrary stable strings the caller builds, e.g. `${date}::${ingredient}`.
 *
 * `loaded` is false until the first read finishes, so callers can avoid a flash
 * of unticked boxes before the saved state arrives.
 */
export function useTickList(storageKey: string) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setTicked(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Malformed or unavailable storage, start empty rather than crash.
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...ticked]));
    } catch {
      // Storage full or blocked, ticks just will not persist this session.
    }
  }, [ticked, loaded, storageKey]);

  const toggle = useCallback((key: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clear = useCallback((keys: string[]) => {
    setTicked((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, []);

  const has = useCallback((key: string) => ticked.has(key), [ticked]);

  return { has, toggle, clear, loaded };
}
