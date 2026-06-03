"use client";

import { useMemo } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { formatLongDate, toISODate } from "@/lib/order";

export default function AdminShoppingListPage() {
  const { orders, products, hydrated } = useAdmin();

  // Ingredients needed per upcoming fulfillment day, summed across that day's
  // non-cancelled orders. Quantity = number of items using each ingredient.
  const days = useMemo(() => {
    const ingredientsByProduct = new Map<string, string[]>();
    for (const p of products) ingredientsByProduct.set(p.id, p.ingredients ?? []);

    const today = toISODate(new Date());
    const active = orders.filter(
      (o) => o.status !== "cancelled" && o.scheduledDate >= today,
    );

    const byDate = new Map<string, Map<string, number>>();
    for (const order of active) {
      const map = byDate.get(order.scheduledDate) ?? new Map<string, number>();
      for (const item of order.items) {
        const ingredients = ingredientsByProduct.get(item.productId);
        if (!ingredients) continue; // bundles/boxes/unknown lines have no recipe
        for (const ing of ingredients) {
          map.set(ing, (map.get(ing) ?? 0) + item.quantity);
        }
      }
      byDate.set(order.scheduledDate, map);
    }

    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, map]) => ({
        date,
        ingredients: [...map.entries()]
          .map(([name, qty]) => ({ name, qty }))
          .sort((x, y) => y.qty - x.qty || x.name.localeCompare(y.name)),
      }))
      .filter((d) => d.ingredients.length > 0);
  }, [orders, products]);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Shopping list</h1>
      <p className="mt-1 text-muted">
        Ingredients you will need for upcoming orders, grouped by day. The number is how many
        items use each ingredient.
      </p>

      {!hydrated ? (
        null
      ) : days.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-muted">
          Nothing coming up. New orders will fill this in.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {days.map((day) => (
            <section key={day.date} className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-display text-lg font-semibold">{formatLongDate(day.date)}</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {day.ingredients.map((ing) => (
                  <li key={ing.name} className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" />
                      {ing.name}
                    </label>
                    <span className="font-semibold text-muted">{ing.qty}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
