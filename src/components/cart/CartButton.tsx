"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "./CartContext";
import { cn } from "@/lib/cn";

export function CartButton() {
  const { count, hydrated } = useCart();
  const prevCount = useRef(count);
  // Bumps once per increase. Used as a key so the pop animation restarts each time.
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (count > prevCount.current) setBump((b) => b + 1);
    prevCount.current = count;
  }, [count]);

  return (
    <Link
      href="/cart"
      className="relative rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-[0.97]"
    >
      Cart
      {hydrated && count > 0 && (
        <span
          key={bump}
          className={cn(
            "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-deep px-1 text-xs font-bold text-white",
            bump > 0 && "animate-pop",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
