// Shared Tailwind class strings for form inputs, so the same string isn't
// copied into every form. Two variants are in use across the app.

/** Roomier input, customer-facing + auth forms. */
export const inputClass =
  "w-full rounded-xl border border-line bg-white px-4 py-2.5 transition focus:border-rose";

/** Compact input, admin panel forms. 16px on phones so iOS Safari never zooms on focus. */
export const compactInputClass =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-rose sm:text-sm";
