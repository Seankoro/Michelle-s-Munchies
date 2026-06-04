// Shared Tailwind class strings for form inputs, so the same string isn't
// copied into every form. Two variants are in use across the app.

/** Roomier input, customer-facing + auth forms. */
export const inputClass =
  "w-full rounded-xl border border-line bg-white px-4 py-2.5 outline-none transition focus:border-rose";

/** Compact input, admin panel forms. */
export const compactInputClass =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-rose";
