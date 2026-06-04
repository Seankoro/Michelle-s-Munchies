/**
 * Safety disclaimer shown when a product offers options that may include
 * ingredient substitutions like oat milk, plant butter, or gluten-free flour.
 * We deliberately do not recompute the allergen and dietary badges when a
 * substitution is chosen, those stay as the product's base recipe, so this
 * note tells customers to confirm allergies directly.
 */
export function SubstitutionNote({ className }: { className?: string }) {
  return (
    <p
      className={`rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted ${className ?? ""}`}
    >
      🥛 Some options swap ingredients like oat milk or plant butter. These change the recipe, so
      the allergen list above reflects the standard version. Please tell us about any allergies in
      your order notes and we&rsquo;ll confirm.
    </p>
  );
}
