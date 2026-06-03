"use client";

import { useEffect } from "react";
import { useCart } from "./CartContext";

/**
 * Empties the cart once the customer reaches the order tracking page. Placed
 * here (rather than at checkout submit) so a cancelled Stripe payment returns
 * the customer to checkout with their cart still intact.
 */
export function ClearCartOnMount() {
  const { clear, hydrated } = useCart();
  // Wait for the provider to finish loading localStorage before clearing —
  // otherwise its hydration effect (a parent effect, which runs *after* this
  // child effect) would reload the saved cart and clobber the clear.
  useEffect(() => {
    if (hydrated) clear();
  }, [hydrated, clear]);
  return null;
}
