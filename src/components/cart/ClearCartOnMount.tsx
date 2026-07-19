"use client";

import { useEffect } from "react";
import { useCart } from "./CartContext";

/**
 * Empties the cart once the customer reaches the order tracking page. Placed
 * here instead of at checkout submit so a cancelled Stripe payment returns
 * the customer to checkout with their cart still intact.
 *
 * Only clears when checkout set the just-placed marker. The tracking page is
 * revisited for days from status emails and bookmarks, and those visits must
 * never wipe a cart the customer is building for their next order.
 */
export function ClearCartOnMount() {
  const { clear, hydrated } = useCart();
  // Wait for the provider to finish loading localStorage before clearing.
  // Otherwise its hydration effect, a parent effect that runs after this child
  // effect, would reload the saved cart and clobber the clear.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (window.sessionStorage.getItem("mm-order-placed")) {
        window.sessionStorage.removeItem("mm-order-placed");
        clear();
      }
    } catch {
      // Storage unavailable: keep the old always-clear behaviour so a placed
      // order still empties the cart.
      clear();
    }
  }, [hydrated, clear]);
  return null;
}
